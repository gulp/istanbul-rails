import requests # Keep for potential future use, not strictly needed for this task
from bs4 import BeautifulSoup
import re
import json
from urllib.parse import urljoin # Keep for potential future use
import time # Keep for potential future use
import markdown # For parsing Markdown tables

ALL_STATIONS_DICT = {} # Initialize global dictionary for stations from MD

# --- Helper Functions (from previous script, some might be adapted) ---
def clean_text(text):
    """Cleans common Wikipedia text artifacts and general text."""
    text = re.sub(r'\[.*?\]\(.*?\)', lambda match: match.group(0).split('](')[0][1:], text) # Clean MD links but keep text
    text = re.sub(r'\[\[(?:[^|\]]+\|)?([^\]]+)\]\]', r'\1', text) # Clean Wiki links
    text = re.sub(r'\[.*?\]', '', text)  # Remove reference links like [1], [a]
    text = text.replace('\n', ' ').replace('<br>', ' ').replace('<br/>', ' ').replace('<br />', ' ')
    text = text.strip()
    text = re.sub(r'\s+', ' ', text) # Normalize whitespace
    return text

def normalize_name_to_id(name):
    """Creates a consistent ID-friendly version of a station or line name."""
    name = clean_text(name) # Basic cleaning (like MD link removal)

    # Explicitly handle em-dashes and hyphens by replacing them with a space first
    # This ensures they act as word separators before space-to-underscore conversion.
    name = name.replace('—', ' ') # em-dash to space
    name = name.replace('-', ' ') # hyphen to space

    # Character transliteration (Turkish to ASCII-like)
    name = name.replace('İ', 'I').replace('ı', 'i')
    name = name.replace('Ö', 'O').replace('ö', 'o')
    name = name.replace('Ü', 'U').replace('ü', 'u')
    name = name.replace('Ş', 'S').replace('ş', 's')
    name = name.replace('Ç', 'C').replace('ç', 'c')
    name = name.replace('Ğ', 'G').replace('ğ', 'g')
    name = name.replace('Â', 'A').replace('â', 'a') # Handle Â/â
    
    name = name.lower()
    
    # Remove any remaining punctuation that isn't a letter, number, or whitespace
    name = re.sub(r'[^\w\s]', '', name)
    
    # Convert all whitespace sequences to a single underscore
    name = re.sub(r'\s+', '_', name)
    
    name = name.strip('_') # Remove leading/trailing underscores
    return name if name else "unknown_id_" + str(time.time()) # Ensure an ID is always returned

KNOWN_LINE_CODES_FROM_JSON = set() # Will be populated from input JSON

def parse_md_transfer_cell(cell_content, current_line_id):
    """
    Parses a transfer cell from Markdown to extract line codes and other transfer types.
    """
    transfers = set()
    # BeautifulSoup to handle HTML-like elements within Markdown (e.g., img tags if they render)
    # Or just regex for common patterns in the MD's transfer column.
    # The MD uses image alt text or direct text for lines.
    
    # Example patterns to look for from your MD:
    # [![Line M1]...](...) -> M1
    # Marmaray -> MARMARAY
    # Yusufpaşa -> T1 (if we have a mapping, or we add 'Yusufpasa' as a transfer point)
    # İETT Bus -> IETT_BUS
    # Yenikapı Terminal -> FERRY (or a specific terminal ID)

    # Extract from Markdown image links like ![[Line M2]...
    # Or from direct text like "Marmaray"
    
    # Let's use regex on the raw cell_content string
    # For line symbols like M1, T2, F1, B (Marmaray often shown as B)
    # This regex looks for typical line codes, possibly within parentheses or as standalone codes.
    # It also looks for explicit "Marmaray", "Metrobus" text.
    # And generic "Ferries" or "IDO", "Şehir Hatları", "Turyol"
    
    # First, extract text from Markdown links: [Text](URL) -> Text
    text_content = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', cell_content)
    text_content = clean_text(text_content) # Basic cleaning

    # Try to find explicit line codes (M1, T1, F1, etc.)
    # This pattern is a bit more complex to catch codes that might be part of link text
    # or surrounded by other text.
    line_code_matches = re.findall(r'\b([MTFB]\d+[AB]?)\b', text_content, re.IGNORECASE)
    for code in line_code_matches:
        transfers.add(code.upper())

    if "marmaray" in text_content.lower():
        transfers.add("MARMARAY")
    if "metrobus" in text_content.lower() or "metrobüs" in text_content.lower():
        transfers.add("METROBUS")
    if "iett bus" in text_content.lower():
        transfers.add("IETT_BUS") # Generic bus transfer
    if "ferry" in text_content.lower() or "şehir hatları" in text_content.lower() or \
       "ido" in text_content.lower() or "turyol" in text_content.lower() or \
       "dentur" in text_content.lower() or "yenikapı terminal" in text_content.lower() or \
       "bostancı pier" in text_content.lower(): # More specific ferry terms
        transfers.add("FERRY")
    if "havabüs" in text_content.lower() or "havaist" in text_content.lower(): # Airport shuttle
        transfers.add("AIRPORT_SHUTTLE")
    if "high speed train" in text_content.lower() or "yüksek hızlı tren" in text_content.lower() or "yht" in text_content.lower():
        transfers.add("YHT")


    # Check for station names that are known transfer points to other lines (harder without full context)
    # e.g. "Yusufpaşa" is known T1. "Laleli–Istanbul University station" is T1.
    # This requires a pre-defined mapping or more sophisticated NLP, which is complex.
    # For now, we focus on explicit line codes and keywords.
    # We can add a simple check for known interchange station names IF they imply a specific line.
    # e.g., if "Yusufpaşa" appears, and T1 exists in KNOWN_LINE_CODES_FROM_JSON, add T1.
    
    # For station names mentioned as transfers, like "(Laleli–Istanbul University station)" for T1 at Vezneciler M2
    # Or "Yusufpaşa" for T1 at Aksaray M1
    # This part becomes tricky as it requires knowing which station maps to which line.
    # A simple heuristic: if a known line code is mentioned *near* a station name in parentheses.
    
    # Example: " (Laleli–Istanbul University station)"
    # If we know "Laleli-Istanbul University" is on T1, we add T1.
    # This is an advanced step. For now, focus on direct codes.

    if current_line_id:
        transfers.discard(current_line_id.upper())
    return sorted(list(t for t in transfers if t)) # Remove empty strings

def parse_markdown_file(md_content):
    """
    Parses the provided Markdown content to extract line and station data.
    """
    lines_from_md = {} # Key: line_id, Value: {"name": "Line Name", "stations": [...], "branches": {...}}
    
    # Split content into sections based on "### Line Name"
    # Assuming H3 for line/branch sections
    # Regex to find "### Line Name" and the table that follows
    # This regex is a bit naive, might need refinement if MD structure varies.
    # It looks for H3, then captures text until the next H3 or end of file.
    sections = re.split(r'(^###\s+.*)', md_content, flags=re.MULTILINE)
    
    current_line_name_full = None
    current_line_id_md = None
    current_branch_name_md = "main" # Default branch

    for i, section_content in enumerate(sections):
        if section_content.startswith("###"):
            current_line_name_full = section_content.replace("###", "").strip()
            # Attempt to extract a line code (e.g., M1, M2) and a branch name if specified
            line_code_match = re.match(r'^([MTFB]\d+[AB]?)\b', current_line_name_full, re.IGNORECASE)
            if line_code_match:
                current_line_id_md = line_code_match.group(1).upper()
                # Check if it's a specific branch definition
                if "branch" in current_line_name_full.lower():
                    # Try to get branch name (e.g. M1A from "M1A branch")
                    branch_name_candidate = current_line_name_full.split("branch")[0].strip()
                    if branch_name_candidate.upper().startswith(current_line_id_md) and len(branch_name_candidate) > len(current_line_id_md):
                         current_branch_name_md = normalize_name_to_id(branch_name_candidate) # e.g. m1a
                    else: # Fallback if branch name isn't just the extended code
                         current_branch_name_md = normalize_name_to_id(current_line_name_full)

                elif "trunk section" in current_line_name_full.lower():
                    current_branch_name_md = "main_trunk" # Special name for M1 trunk
                elif re.search(r"line$", current_line_name_full.lower()): # e.g. "M2 Line"
                    current_branch_name_md = "main"

                else: # Could be a main line or a branch without "branch" keyword
                    # If current_line_id_md matches a part of current_line_name_full that implies a branch
                    potential_branch_from_name = normalize_name_to_id(current_line_name_full)
                    if potential_branch_from_name.startswith(current_line_id_md.lower()) and len(potential_branch_from_name) > len(current_line_id_md.lower()):
                        current_branch_name_md = potential_branch_from_name
                    else:
                        current_branch_name_md = "main"

            else: # If no clear line code at start of H3, use a normalized version of the H3 text
                current_line_id_md = normalize_name_to_id(current_line_name_full)
                current_branch_name_md = "main" # Assume main if no specific branch info in H3
            
            if current_line_id_md not in lines_from_md:
                lines_from_md[current_line_id_md] = {
                    "name": current_line_name_full, # Store full H3 title as name for now
                    "id": current_line_id_md,
                    "stations": [], # For main/unspecified branch stations
                    "branches": {}
                }
            print(f"Processing MD Section: {current_line_name_full} -> Line ID: {current_line_id_md}, Branch: {current_branch_name_md}")

        elif current_line_id_md and "|" in section_content: # Likely a table
            # Use markdown library to convert table to HTML, then BeautifulSoup
            html = markdown.markdown(section_content, extensions=['markdown.extensions.tables'])
            soup = BeautifulSoup(html, 'html.parser')
            table = soup.find('table')
            if not table:
                continue

            headers = []
            actual_header_row_for_data_iteration = None # To know which row was the header
            header_found = False
            all_table_rows = table.find_all('tr')
            data_row_start_index = 0

            # Find the first row that seems to be a header (has content)
            for i, r in enumerate(all_table_rows):
                potential_headers_text = [clean_text(cell.get_text()) for cell in r.find_all(['th', 'td'])]
                if any(h.strip() for h in potential_headers_text): # If any cell in the row has actual text
                    headers = [h.lower() for h in potential_headers_text]
                    actual_header_row_for_data_iteration = r
                    header_found = True
                    data_row_start_index = i + 1 # Data rows start after this header
                    break
            
            if not header_found:
                print(f"Warning: No contentful header row found for table in {current_line_name_full}. Skipping table.")
                continue
            
            try:
                station_col_idx = headers.index("station")
            except ValueError:
                if current_line_id_md == "M9" and "transfer" in headers:
                    print(f"Info: For M9, 'station' column not found. The MD for M9 needs a 'Station' column. Found 'transfer' column as first: {headers}. Skipping M9 station processing from this table.")
                else:
                    print(f"Warning: 'Station' column not found in table for {current_line_name_full}. Headers: {headers}. Skipping table.")
                continue # Skip table if no station column

            transfer_col_idx = headers.index("transfer") if "transfer" in headers else headers.index("connections") if "connections" in headers else -1
            notes_col_idx = headers.index("notes") if "notes" in headers else -1
            district_col_idx = headers.index("district") if "district" in headers else -1
            
            stations_for_current_section = []

            for row_idx in range(data_row_start_index, len(all_table_rows)):
                row = all_table_rows[row_idx]
                cells = row.find_all('td')
                if not cells or len(cells) <= station_col_idx:
                    # Check for "↓↓ Inauguration planned..." type rows
                    if cells and "inauguration planned" in cells[0].get_text(strip=True).lower():
                        print(f"  Skipping future stations row: {cells[0].get_text(strip=True)}")
                    continue

                raw_station_name = cells[station_col_idx].get_text(strip=True)
                # Clean Markdown link from station name: [Station Name](URL) -> Station Name
                station_name_match = re.match(r'\[([^\]]+)\]\(.*\)', raw_station_name)
                station_name = station_name_match.group(1) if station_name_match else raw_station_name
                station_name = clean_text(station_name.replace("~~","")) # Remove strikethrough for under construction

                if not station_name:
                    continue

                station_id = normalize_name_to_id(station_name)
                
                transfers_text = cells[transfer_col_idx].decode_contents() if transfer_col_idx != -1 and len(cells) > transfer_col_idx else "" # Get raw HTML/MD for parsing complex transfers
                transfers = parse_md_transfer_cell(transfers_text, current_line_id_md)
                
                notes = clean_text(cells[notes_col_idx].get_text(strip=True)) if notes_col_idx != -1 and len(cells) > notes_col_idx else ""
                district = clean_text(cells[district_col_idx].get_text(strip=True)) if district_col_idx != -1 and len(cells) > district_col_idx else ""
                
                station_data = {
                    "id": station_id,
                    "name": station_name, # Use cleaned name from MD
                    "transfers": transfers,
                    "notes": notes,
                    "district": district,
                    "md_line_id": current_line_id_md, # Store which MD line it came from
                    "md_branch_name": current_branch_name_md
                }
                stations_for_current_section.append(station_data)
            
            # Add these stations to the correct line and branch
            line_obj = lines_from_md[current_line_id_md]
            if current_branch_name_md == "main" or current_branch_name_md == current_line_id_md: # If H3 was just "M2 Line"
                line_obj["stations"].extend(s["id"] for s in stations_for_current_section)
            elif current_branch_name_md == "main_trunk" and current_line_id_md == "M1": # M1 Trunk
                 line_obj["stations"].extend(s["id"] for s in stations_for_current_section)
            else: # It's a named branch
                if current_branch_name_md not in line_obj["branches"]:
                    line_obj["branches"][current_branch_name_md] = []
                line_obj["branches"][current_branch_name_md].extend(s["id"] for s in stations_for_current_section)

            # Also collect all unique stations from MD to update/add to global station list later
            for s_data in stations_for_current_section:
                if s_data["id"] not in ALL_STATIONS_DICT: # Using ALL_STATIONS_DICT to store unique station details from MD
                    ALL_STATIONS_DICT[s_data["id"]] = {
                        "id": s_data["id"],
                        "name": s_data["name"],
                        "district": s_data["district"],
                        "lines": set(), # Will be populated during consolidation
                        "transfers": set(s_data["transfers"]), # Store MD transfers
                        "notes": s_data["notes"]
                    }
                else: # Update existing entry if MD provides more/different info
                    ALL_STATIONS_DICT[s_data["id"]]["name"] = s_data["name"] # MD name takes precedence
                    if s_data["district"]: ALL_STATIONS_DICT[s_data["id"]]["district"] = s_data["district"]
                    ALL_STATIONS_DICT[s_data["id"]]["transfers"].update(s_data["transfers"])
                    if s_data["notes"]: ALL_STATIONS_DICT[s_data["id"]]["notes"] = s_data["notes"]

    return lines_from_md


def consolidate_data(json_data, md_lines_data):
    """
    Consolidates data from json_data with md_lines_data.
    MD data generally takes precedence for station names, notes, transfers, and line station order.
    """
    # 0. Re-normalize IDs in the input json_data (from stations_lines.json)
    renormalized_stations_by_new_id = {}
    old_id_to_new_id_map = {} # To update line station lists

    print("Phase 0: Re-normalizing IDs in loaded JSON data...")
    for station_from_json in json_data.get("stations", []):
        original_json_id = station_from_json.get("id")
        station_name = station_from_json.get("name")

        if not station_name:
            print(f"  Warning: Station from input JSON with ID '{original_json_id}' has no name. Skipping re-normalization for this entry.")
            if original_json_id and original_json_id not in renormalized_stations_by_new_id: # Keep if ID is unique and not already processed
                 renormalized_stations_by_new_id[original_json_id] = station_from_json
                 old_id_to_new_id_map[original_json_id] = original_json_id
            continue

        new_id = normalize_name_to_id(station_name)
        old_id_to_new_id_map[original_json_id] = new_id

        if new_id in renormalized_stations_by_new_id:
            existing_station = renormalized_stations_by_new_id[new_id]
            print(f"  Info: Merging JSON station '{station_name}' (old ID: {original_json_id}) into existing entry with new ID '{new_id}'.")
            
            existing_lines = set(existing_station.get("lines", []))
            current_lines = set(station_from_json.get("lines", []))
            existing_station["lines"] = sorted(list(existing_lines.union(current_lines)))

            existing_transfers = set(existing_station.get("transfers", []))
            current_transfers = set(station_from_json.get("transfers", []))
            existing_station["transfers"] = sorted(list(existing_transfers.union(current_transfers)))
            
            if not existing_station.get("district") and station_from_json.get("district"):
                existing_station["district"] = station_from_json.get("district")
            if not existing_station.get("notes") and station_from_json.get("notes"):
                existing_station["notes"] = station_from_json.get("notes")
            existing_station["name"] = station_name # Ensure name consistency
            if "coordinates" not in existing_station and "coordinates" in station_from_json:
                existing_station["coordinates"] = station_from_json["coordinates"]
            # Add other fields to merge as needed, e.g., type
            if not existing_station.get("type") and station_from_json.get("type"):
                existing_station["type"] = station_from_json.get("type")

        else:
            station_from_json["id"] = new_id
            renormalized_stations_by_new_id[new_id] = station_from_json

    json_data["stations"] = list(renormalized_stations_by_new_id.values())
    print(f"  Re-normalization of JSON station IDs complete. {len(json_data['stations'])} unique stations after re-normalizing input JSON.")

    # Update station IDs within the 'lines' definitions of json_data
    for line_from_json in json_data.get("lines", []):
        if "stations" in line_from_json:
            updated_stations = []
            for s_id in line_from_json["stations"]:
                updated_stations.append(old_id_to_new_id_map.get(s_id, s_id))
            line_from_json["stations"] = list(dict.fromkeys(updated_stations)) # Remove duplicates

        if "branches" in line_from_json:
            for branch_name in line_from_json["branches"]:
                updated_branch_stations = []
                for s_id in line_from_json["branches"][branch_name]:
                    updated_branch_stations.append(old_id_to_new_id_map.get(s_id, s_id))
                line_from_json["branches"][branch_name] = list(dict.fromkeys(updated_branch_stations))
    print("  Updated station ID references in JSON line definitions.")
    # --- End of re-normalization of json_data ---

    # Create lookup for JSON stations (now using re-normalized IDs)
    json_stations_lookup = {s["id"]: s for s in json_data["stations"]}
    json_lines_lookup = {}
    for line_data in json_data.get("lines", []):
        # Ensure line_data has an 'id' and it's a string before calling .upper()
        original_line_id = line_data.get("id")
        if isinstance(original_line_id, str):
            line_id_upper = original_line_id.upper()
            line_data["id"] = line_id_upper # Ensure stored ID is also uppercase
            json_lines_lookup[line_id_upper] = line_data
        else:
            # Handle cases where line_id might be missing or not a string, if necessary
            print(f"Warning: Line data found with missing or non-string ID: {line_data}. Skipping this line for lookup.")

    # Populate KNOWN_LINE_CODES_FROM_JSON for transfer parsing reference
    for line_id in json_lines_lookup.keys():
        KNOWN_LINE_CODES_FROM_JSON.add(line_id)
    for line_id in md_lines_data.keys(): # Also add line IDs defined in MD
        KNOWN_LINE_CODES_FROM_JSON.add(line_id)


    # 1. Update/Add Stations from ALL_STATIONS_DICT (populated by parse_markdown_file)
    final_station_list = []
    processed_station_ids = set()

    for md_station_id, md_station_info in ALL_STATIONS_DICT.items():
        if md_station_id in json_stations_lookup:
            # Update existing station
            json_station = json_stations_lookup[md_station_id]
            json_station["name"] = md_station_info["name"] # MD name takes precedence
            if md_station_info["district"]: json_station["district"] = md_station_info["district"]
            # Merge transfers: take MD's list as authoritative for this station
            json_station["transfers"] = sorted(list(set(md_station_info["transfers"]))) # Use set for uniqueness
            if md_station_info["notes"]: json_station["notes"] = md_station_info["notes"]
            # Lines will be updated/managed when processing lines
            json_station.setdefault("lines", []) # Ensure 'lines' key exists
        else:
            # Add new station from MD
            new_station = {
                "id": md_station_id,
                "name": md_station_info["name"],
                "district": md_station_info["district"],
                "lines": [], # Will be populated when processing lines
                "transfers": sorted(list(set(md_station_info["transfers"]))),
                "notes": md_station_info["notes"],
                "type": None # Default type, can be updated if MD provides it
            }
            json_stations_lookup[md_station_id] = new_station # Add to lookup for line processing
        processed_station_ids.add(md_station_id)

    # Add any stations from original JSON that were not in MD
    for s_id, s_data in json_stations_lookup.items():
        if s_id not in processed_station_ids: # Should not happen if json_stations_lookup was basis
             final_station_list.append(s_data) #This logic path may need review.
        # The goal is that json_stations_lookup now contains all stations, updated or new.

    # 2. Update/Add Lines
    for md_line_id, md_line_info in md_lines_data.items():
        md_line_id_upper = md_line_id.upper() # Ensure consistent casing for lookup
        
        # Determine the primary line ID (e.g. M1 from M1A)
        primary_line_id_match = re.match(r'^([MTFB]\d+)', md_line_id_upper)
        primary_line_id = primary_line_id_match.group(1) if primary_line_id_match else md_line_id_upper
        
        if primary_line_id not in json_lines_lookup:
            # Line from MD does not exist in JSON, create it
            print(f"Creating new line from MD: {primary_line_id}")
            json_lines_lookup[primary_line_id] = {
                "id": primary_line_id,
                "name": md_line_info.get("name", f"{primary_line_id} - Unknown Line Name"), # Use H3 from MD as name
                "color": "#CCCCCC", # Default color
                "type": "Unknown", # Infer type later if possible
                "stations": [],
                "branches": {}
            }
        
        target_line = json_lines_lookup[primary_line_id] # The line object to update/populate
        
        # Update line name if MD provides a more complete one for the primary ID
        if md_line_id_upper == primary_line_id and "name" in md_line_info:
             target_line["name"] = md_line_info["name"]

        # Update stations for the main part of the line or specific branches
        if md_line_info.get("stations"): # Stations listed directly under the line_id in md_lines_data
            target_line["stations"] = list(dict.fromkeys(md_line_info["stations"])) # MD order takes precedence, ensure unique

        for branch_id_md, branch_stations_md in md_line_info.get("branches", {}).items():
            # Normalize MD branch ID (e.g. m1a -> M1A)
            normalized_branch_id_for_json = branch_id_md.upper() 
            # If MD branch ID isn't just the sub-code (M1A), but derived from H3, ensure it's useful.
            # Example: if MD branch_id_md = "m1a_branch", we want key "M1A" in JSON.
            # This logic might need to be smarter based on how branch_id_md is formed in parse_markdown_file
            
            target_line.setdefault("branches", {}) # Ensure branches dict exists
            target_line["branches"][normalized_branch_id_for_json] = list(dict.fromkeys(branch_stations_md))
            print(f"  Updated/Set branch '{normalized_branch_id_for_json}' for line '{primary_line_id}' with {len(branch_stations_md)} stations from MD.")


        # Infer line type if still "Unknown"
        if target_line["type"] == "Unknown":
            if primary_line_id.startswith("M"): target_line["type"] = "Metro"
            elif primary_line_id.startswith("T"): target_line["type"] = "Tram"
            elif primary_line_id.startswith("F"): target_line["type"] = "Funicular"
            elif primary_line_id == "MARMARAY": target_line["type"] = "Suburban Rail"
            elif primary_line_id == "METROBUS": target_line["type"] = "BRT"

    # 3. Update station 'lines' list and 'isInterchange'
    # First, clear all existing line memberships for stations from JSON
    for station in json_stations_lookup.values():
        station["lines"] = set() # Use set for easier addition

    # Then, rebuild based on the (potentially new) line structures
    for line_obj in json_lines_lookup.values():
        line_id_upper = line_obj["id"].upper()
        all_line_stations = set(line_obj.get("stations", []))
        for branch_stations in line_obj.get("branches", {}).values():
            all_line_stations.update(branch_stations)
        
        for station_id_on_line in all_line_stations:
            if station_id_on_line in json_stations_lookup:
                json_stations_lookup[station_id_on_line]["lines"].add(line_id_upper)
            else:
                print(f"Warning: Station ID '{station_id_on_line}' found in line '{line_id_upper}' definition but not in master station list. This might indicate an orphaned station from MD parsing or a new station not yet added to ALL_STATIONS_DICT correctly.")


    # Convert set of lines to sorted list and set isInterchange
    final_station_list_consolidated = []
    for station_id, station_data in json_stations_lookup.items():
        station_data["lines"] = sorted(list(station_data["lines"]))
        # An interchange has multiple lines OR multiple distinct transfer line codes listed
        # Filter out generic transfers like IETT_BUS, FERRY for interchange decision based on rail lines
        rail_transfers = {t for t in station_data.get("transfers", []) if t in KNOWN_LINE_CODES_FROM_JSON}
        station_data["isInterchange"] = len(station_data["lines"]) > 1 or len(rail_transfers) > 0 
        final_station_list_consolidated.append(station_data)


    return {"stations": final_station_list_consolidated, "lines": list(json_lines_lookup.values())}


if __name__ == "__main__":
    md_file_path = "202505191432 metro-data.md" # Path to your MD file
    json_file_path = "../data/stations_lines.json" # Path to your input JSON file
    output_json_path = "consolidated_metro_data.json"

    # Load existing JSON data
    try:
        with open(json_file_path, 'r', encoding='utf-8') as f:
            current_json_data = json.load(f)
        print(f"Successfully loaded '{json_file_path}'.")
    except FileNotFoundError:
        print(f"Error: Input JSON file '{json_file_path}' not found. Starting with an empty dataset.")
        current_json_data = {"stations": [], "lines": []}
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from '{json_file_path}'. Ensure it's valid. Starting with an empty dataset.")
        current_json_data = {"stations": [], "lines": []}

    # Load and parse MD file
    try:
        with open(md_file_path, 'r', encoding='utf-8') as f:
            md_content = f.read()
        print(f"Successfully loaded '{md_file_path}'. Parsing...")
        # Initialize ALL_STATIONS_DICT before parsing MD, as parse_markdown_file populates it
        ALL_STATIONS_DICT.clear() 
        md_parsed_lines = parse_markdown_file(md_content)
        print(f"Parsed {len(md_parsed_lines)} line groups and {len(ALL_STATIONS_DICT)} unique stations from MD.")
    except FileNotFoundError:
        print(f"Error: Markdown file '{md_file_path}' not found. No MD data will be consolidated.")
        md_parsed_lines = {}
        ALL_STATIONS_DICT.clear() # Ensure it's empty if MD not found

    # Consolidate
    print("Consolidating data...")
    consolidated_data = consolidate_data(current_json_data, md_parsed_lines)
    
    # Save consolidated data
    try:
        with open(output_json_path, 'w', encoding='utf-8') as f:
            json.dump(consolidated_data, f, ensure_ascii=False, indent=2)
        print(f"Consolidated data successfully saved to '{output_json_path}'.")
        print(f"\nSummary of consolidated data:")
        print(f"  Total stations: {len(consolidated_data.get('stations', []))}")
        print(f"  Total lines: {len(consolidated_data.get('lines', []))}")
        if consolidated_data.get('lines'):
            sample_line = consolidated_data['lines'][0]
            print(f"  Sample line: {sample_line.get('id')} with {len(sample_line.get('stations',[]))} main stations and {len(sample_line.get('branches',{}))} branches.")

    except IOError:
        print(f"Error: Could not write consolidated data to '{output_json_path}'.")