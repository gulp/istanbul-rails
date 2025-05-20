import os
import markdown
from bs4 import BeautifulSoup
import re
import json
import time
import argparse # For command-line arguments

# --- Helper Functions (normalize_name_to_id, clean_text, parse_md_transfer_cell) ---
# (These should be identical to what we've refined previously)
def clean_text(text):
    text = re.sub(r'\[.*?\]\(.*?\)', lambda match: match.group(0).split('](')[0][1:], text)
    text = re.sub(r'\[\[(?:[^|\]]+\|)?([^\]]+)\]\]', r'\1', text)
    text = re.sub(r'\[.*?\]', '', text)
    text = text.replace('\n', ' ').replace('<br>', ' ').replace('<br/>', ' ').replace('<br />', ' ')
    text = text.strip()
    text = re.sub(r'\s+', ' ', text)
    return text

def normalize_name_to_id(name):
    name = clean_text(name)
    name = re.sub(r'\s*\(Istanbul Metro\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(Istanbul Tram\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(Marmaray\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(İETT\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*Metrobüs Station', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(Metro\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(Tram\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(Funicular\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(Cable Car\)', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*branch$', '', name, flags=re.IGNORECASE) 
    name = re.sub(r'\s*line$', '', name, flags=re.IGNORECASE) 
    name = re.sub(r'\s*section$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*trunk$', '', name, flags=re.IGNORECASE)

    name = name.replace('İ', 'I').replace('ı', 'i')
    name = name.replace('Ö', 'O').replace('ö', 'o')
    name = name.replace('Ü', 'U').replace('ü', 'u')
    name = name.replace('Ş', 'S').replace('ş', 's')
    name = name.replace('Ç', 'C').replace('ç', 'c')
    name = name.replace('Ğ', 'G').replace('ğ', 'g')
    name = name.replace('Â', 'A').replace('â', 'a') # Added for â
    
    name = name.lower()
    # Replace one or more spaces or any kind of dash/hyphen (unicode range \u2010-\u2015) with a single underscore
    name = re.sub(r'[\s\u2010-\u2015-]+', '_', name)
    # Remove anything that's not a word character or underscore
    name = re.sub(r'[^\w_]', '', name)
    name = re.sub(r'_+', '_', name) 
    name = name.strip('_')
    return name if name else "unknown_id_" + str(time.time())

ALL_PARSED_STATIONS_MASTER = {} 
KNOWN_LINE_CODES_MASTER = set()

def parse_md_transfer_cell(cell_content, current_line_id):
    transfers = set()
    text_content = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', cell_content)
    text_content = clean_text(text_content)
    line_code_matches = re.findall(r'\b([MTFB]\d+[AB]?)\b', text_content, re.IGNORECASE)
    for code in line_code_matches:
        if code.upper() in KNOWN_LINE_CODES_MASTER or re.match(r'^[MTFB]\d', code.upper()):
            transfers.add(code.upper())
    if "marmaray" in text_content.lower(): transfers.add("MARMARAY")
    if "metrobus" in text_content.lower() or "metrobüs" in text_content.lower(): transfers.add("METROBUS")
    if "iett bus" in text_content.lower(): transfers.add("IETT_BUS")
    if "ferry" in text_content.lower() or "şehir hatları" in text_content.lower() or \
       "ido" in text_content.lower() or "turyol" in text_content.lower() or \
       "dentur" in text_content.lower() or "terminal" in text_content.lower() or "pier" in text_content.lower() : 
        transfers.add("FERRY")
    if "havabüs" in text_content.lower() or "havaist" in text_content.lower(): transfers.add("AIRPORT_SHUTTLE")
    if "high speed train" in text_content.lower() or "yht" in text_content.lower() or "yüksek hızlı tren" in text_content.lower(): transfers.add("YHT")
    if current_line_id:
        transfers.discard(current_line_id.upper())
    return sorted(list(t for t in transfers if t))
# --- (End of Helper Functions) ---

def parse_single_markdown_file(md_filepath, default_line_type="Unknown"):
    """
    Parses a single Markdown file to extract line and station data.
    Updates ALL_PARSED_STATIONS_MASTER and returns a dictionary of lines found in this MD.
    """
    lines_from_this_md = {}
    try:
        with open(md_filepath, 'r', encoding='utf-8') as f:
            md_content = f.read()
        print(f"DEBUG: Successfully loaded MD content from '{md_filepath}'. First 100 chars: {md_content[:100]}")
    except FileNotFoundError:
        print(f"Error: Markdown file '{md_filepath}' not found. Skipping.")
        return {}

    sections = re.split(r'(^###\s+.*)', md_content, flags=re.MULTILINE)
    print(f"DEBUG: Split MD into {len(sections)} sections based on H3.")

    current_line_name_full = None
    current_line_id_md = None
    current_branch_name_md = "main"

    for i, section_content in enumerate(sections):
        if section_content.startswith("###"):
            current_line_name_full = section_content.replace("###", "").strip()
            print(f"DEBUG: Found H3 section: {current_line_name_full}")

            line_code_match = re.match(r'^([MTFB]\d+[AB]?)\b', current_line_name_full, re.IGNORECASE)
            if line_code_match:
                current_line_id_md = line_code_match.group(1).upper()
            else: 
                normalized_h3_id = normalize_name_to_id(current_line_name_full)
                if re.match(r'^[mtfb]\d*', normalized_h3_id):
                     current_line_id_md = normalized_h3_id.upper()
                else:
                    print(f"Warning: Could not determine a clear line ID from MD section: '{current_line_name_full}'. Using normalized H3 as ID: '{normalized_h3_id.upper()}'")
                    current_line_id_md = normalized_h3_id.upper() if normalized_h3_id else None
            if not current_line_id_md:
                print(f"Skipping section, failed to derive line ID: {current_line_name_full}")
                continue
            KNOWN_LINE_CODES_MASTER.add(current_line_id_md) 
            if "branch" in current_line_name_full.lower():
                branch_part = current_line_name_full.split("branch")[0].strip()
                branch_code_match = re.match(r'^([MTFB]\d+[AB])\b', branch_part, re.IGNORECASE)
                current_branch_name_md = branch_code_match.group(1).upper() if branch_code_match else normalize_name_to_id(branch_part)
            elif "trunk section" in current_line_name_full.lower(): current_branch_name_md = "main_trunk" 
            else: current_branch_name_md = "main"
            if current_line_id_md not in lines_from_this_md:
                lines_from_this_md[current_line_id_md] = {
                    "name": current_line_name_full, "id": current_line_id_md, "type": default_line_type,
                    "stations": [], "branches": {}
                }
            print(f"  MD Section: {current_line_name_full} -> Line ID: {current_line_id_md}, Branch: {current_branch_name_md}")
        elif current_line_id_md and "|" in section_content: 
            print(f"DEBUG: Found table content for line {current_line_id_md}")

            html = markdown.markdown(section_content, extensions=['markdown.extensions.tables'])
            soup = BeautifulSoup(html, 'html.parser')
            table = soup.find('table')
            if not table: continue
            headers = [clean_text(th.get_text()).lower() for th in table.find('tr').find_all(['th', 'td'])] if table.find('tr') else []
            if default_line_type == "Tram": print(f"  TRAM_DEBUG: Table Headers: {headers}")
            try:
                station_col_idx = headers.index("station")
                if default_line_type == "Tram": print(f"  TRAM_DEBUG: 'station' column index: {station_col_idx}")
            except ValueError:
                if default_line_type == "Tram": print(f"  TRAM_DEBUG: 'station' column not found in headers. Skipping table for {current_line_id_md}.")
                continue
            transfer_col_idx = headers.index("transfer") if "transfer" in headers else headers.index("connections") if "connections" in headers else -1
            notes_col_idx = headers.index("notes") if "notes" in headers else -1
            district_col_idx = headers.index("district") if "district" in headers else -1
            stations_for_this_section_in_md = []
            if default_line_type == "Tram": print(f"  TRAM_DEBUG: Starting row processing for {current_line_id_md}...")
            for i_row, row in enumerate(table.find_all('tr')[1:]):
                cells = row.find_all('td')
                if not cells or len(cells) <= station_col_idx:
                    if default_line_type == "Tram": print(f"    TRAM_DEBUG: Row {i_row}: Not enough cells or 'station' cell missing. Cells: {len(cells)}")
                    if cells and "inauguration planned" in cells[0].get_text(strip=True).lower(): continue
                    continue
                raw_station_name = cells[station_col_idx].get_text(strip=True)
                station_name_match = re.match(r'\[([^\]]+)\]\(.*\)', raw_station_name)
                station_name = station_name_match.group(1) if station_name_match else raw_station_name
                station_name = clean_text(station_name.replace("~~",""))
# Apply character replacements directly to station_name for the 'name' field
# This block is REMOVED to preserve original Turkish characters for display names.
# Deasciification for IDs is handled by normalize_name_to_id().
                
                if default_line_type == "Tram": print(f"    TRAM_DEBUG: Row {i_row}: Raw Name: '{raw_station_name}', Cleaned Name: '{station_name}'")
                if not station_name:
                    if default_line_type == "Tram": print(f"    TRAM_DEBUG: Row {i_row}: Station name is empty after cleaning. Skipping.")
                    continue
                station_id = normalize_name_to_id(station_name)
                if default_line_type == "Tram": print(f"    TRAM_DEBUG: Row {i_row}: Station ID: '{station_id}'")
                transfers_text = cells[transfer_col_idx].decode_contents() if transfer_col_idx != -1 and len(cells) > transfer_col_idx else ""
                transfers = parse_md_transfer_cell(transfers_text, current_line_id_md)
                if default_line_type == "Tram": print(f"    TRAM_DEBUG: Row {i_row}: Parsed Transfers: {transfers}")
                notes = clean_text(cells[notes_col_idx].get_text(strip=True)) if notes_col_idx != -1 and len(cells) > notes_col_idx else ""
                district = clean_text(cells[district_col_idx].get_text(strip=True)) if district_col_idx != -1 and len(cells) > district_col_idx else ""
                stations_for_this_section_in_md.append(station_id)
                if default_line_type == "Tram": print(f"    TRAM_DEBUG: Row {i_row}: Added '{station_id}' to stations_for_this_section_in_md for {current_line_id_md}")
                ALL_PARSED_STATIONS_MASTER.setdefault(station_id, {"id": station_id, "name": station_name, "lines": set(), "transfers": set(), "notes": "", "district": "", "type": None})
                ALL_PARSED_STATIONS_MASTER[station_id]["name"] = station_name
                if district: ALL_PARSED_STATIONS_MASTER[station_id]["district"] = district
                ALL_PARSED_STATIONS_MASTER[station_id]["transfers"].update(transfers)
                if notes: ALL_PARSED_STATIONS_MASTER[station_id]["notes"] = notes
                if default_line_type == "Tram": print(f"    TRAM_DEBUG: Row {i_row}: Updated ALL_PARSED_STATIONS_MASTER for '{station_id}': {ALL_PARSED_STATIONS_MASTER[station_id]}")
            if default_line_type == "Tram": print(f"  TRAM_DEBUG: Finished row processing for {current_line_id_md}. stations_for_this_section_in_md: {stations_for_this_section_in_md}")
            line_obj = lines_from_this_md[current_line_id_md]
            if current_branch_name_md == "main" or current_branch_name_md == "main_trunk":
                line_obj["stations"].extend(stations_for_this_section_in_md)
            else:
                line_obj["branches"].setdefault(current_branch_name_md, [])
                line_obj["branches"][current_branch_name_md].extend(stations_for_this_section_in_md)
    return lines_from_this_md

def merge_and_finalize_data(base_data, all_md_parsed_lines_by_type):
    """
    Merges MD parsed data into base_data and finalizes the structure.
    ALL_PARSED_STATIONS_MASTER contains the authoritative station attributes from MD.
    all_md_parsed_lines_by_type is a dict like: {"Metro": metro_lines_from_md, "Tram": tram_lines_from_md}
    """
    final_stations_lookup = {s["id"]: s for s in base_data.get("stations", [])}

    for station_id, md_station_details in ALL_PARSED_STATIONS_MASTER.items():
        if station_id not in final_stations_lookup:
            # Ensure new stations also start with transfers as a set
            md_station_details.setdefault("transfers", set())
            md_station_details.setdefault("lines", set()) # Ensure lines is a set for new stations too
            final_stations_lookup[station_id] = md_station_details # Add new station
        else: # Update existing
            existing_station = final_stations_lookup[station_id]
            existing_station["name"] = md_station_details["name"]
            if md_station_details.get("district"): 
                existing_station["district"] = md_station_details["district"]
            
            # --- FIX IS HERE ---
            # Ensure existing transfers is a set before updating
            if not isinstance(existing_station.get("transfers"), set):
                existing_station["transfers"] = set(existing_station.get("transfers", [])) # Convert list to set
            
            existing_station["transfers"].update(md_station_details.get("transfers", set()))
            # --- END OF FIX ---

            if md_station_details.get("notes"): 
                existing_station["notes"] = md_station_details["notes"]
        
        # Ensure lines is a set for all stations being processed from MD
        final_stations_lookup[station_id].setdefault("lines", set())

    # ... (rest of the function remains the same) ...
    final_lines_lookup = {l["id"]: l for l in base_data.get("lines", [])}

    for line_type, md_lines in all_md_parsed_lines_by_type.items():
        for md_line_id, md_line_info in md_lines.items():
            md_line_id_upper = md_line_id.upper()
            KNOWN_LINE_CODES_MASTER.add(md_line_id_upper) 
            primary_line_id_match = re.match(r'^([MTFB]\d+)', md_line_id_upper)
            primary_line_id = primary_line_id_match.group(1) if primary_line_id_match else md_line_id_upper
            KNOWN_LINE_CODES_MASTER.add(primary_line_id)
            if primary_line_id not in final_lines_lookup:
                final_lines_lookup[primary_line_id] = {
                    "id": primary_line_id, "name": md_line_info.get("name", f"{primary_line_id} Line"),
                    "color": md_line_info.get("color") or ("#FFA500" if line_type == "Tram" else "#888888"), 
                    "type": line_type, "stations": [], "branches": {}
                }
            target_line = final_lines_lookup[primary_line_id]
            # target_line is final_lines_lookup[primary_line_id]
            target_line["type"] = line_type # Ensure primary line type is set/updated by the current MD context

            is_md_entry_for_branch_segment = (md_line_id_upper != primary_line_id) or \
                                             ("branch" in md_line_info.get("name", "").lower()) or \
                                             ("trunk section" in md_line_info.get("name", "").lower() and primary_line_id != md_line_id_upper)


            if not is_md_entry_for_branch_segment:
                # This md_line_info is for the primary line itself (e.g., "M1 Line" H3 section)
                if md_line_id_upper == primary_line_id: # Double check it's not a branch named like a primary
                    target_line["name"] = md_line_info.get("name", target_line["name"]) # Update name if MD provides it
                if md_line_info.get("color"):
                    target_line["color"] = md_line_info["color"]
                if md_line_info.get("stations"):
                    # This should be the main list of stations for the primary line.
                    # If multiple H3s contribute to M1's main stations, this might overwrite.
                    # Current assumption: one H3 defines the primary station list for a line.
                    target_line["stations"] = list(dict.fromkeys(md_line_info["stations"]))
                
                # Process branches defined *within this primary MD line's own structure* (md_line_info.branches)
                target_line.setdefault("branches", {})
                for branch_key_md, branch_stations_md in md_line_info.get("branches", {}).items():
                    json_branch_key = branch_key_md.upper()
                    # Normalize common suffixes if present from MD internal branch parsing
                    if json_branch_key.endswith("_BRANCH"): json_branch_key = json_branch_key[:-7]
                    if json_branch_key.endswith("_TRUNK"): json_branch_key = "TRUNK" # Or map to a specific key like "MAIN_TRUNK"
                    target_line["branches"][json_branch_key] = list(dict.fromkeys(branch_stations_md))
            else:
                # This md_line_info is for a branch segment defined in its own H3 section
                # (e.g., "### M1A branch" or "### M1 Trunk Section")
                # md_line_id_upper here is the ID derived from the H3 title (e.g., "M1A", "M1_TRUNK_SECTION")
                
                branch_stations_from_md_section = md_line_info.get("stations", [])
                if branch_stations_from_md_section:
                    target_line.setdefault("branches", {})
                    
                    # Determine the key for the branches dictionary.
                    # If md_line_id_upper is "M1A", "M1B", use that.
                    # If it's from "M1 Trunk Section", we need a consistent key like "MAIN_TRUNK" or just "TRUNK".
                    branch_key_for_json = md_line_id_upper # Start with the ID from MD section
                    if "trunk section" in md_line_info.get("name", "").lower():
                        branch_key_for_json = "MAIN_TRUNK" # Standardize trunk key
                    elif branch_key_for_json.endswith("_BRANCH"): # Should be handled by parse_single_markdown_file ideally
                         branch_key_for_json = branch_key_for_json[:-7]
                    
                    # Add/update stations for this branch in the primary line's branches
                    target_line["branches"][branch_key_for_json] = list(dict.fromkeys(branch_stations_from_md_section))
                    
                    # The name of the primary line (target_line["name"]) should remain the main line's name.
                    # The color of the primary line (target_line["color"]) should be the main line's color.
                    # The type of the primary line (target_line["type"]) should be the main line's type.

    # --- MORE ROBUST CLEANUP LOGIC FOR final_lines_lookup ---
    keys_to_remove_from_final_lines = set()
    
    # Step 1: Identify all branch codes that are correctly handled under primary lines
    # and map them to their primary line ID.
    all_properly_handled_branch_codes = set() # e.g., {"M1A", "M1B", "MAIN_TRUNK"}
    branch_to_primary_map = {} # e.g., {"M1A": "M1", "M1B": "M1", "MAIN_TRUNK": "M1"}

    for p_line_id, p_line_obj in final_lines_lookup.items():
        p_line_id_upper = p_line_id.upper()
        for branch_code_key in p_line_obj.get("branches", {}).keys():
            # branch_code_key is already normalized (e.g. "M1A", "MAIN_TRUNK") by the preceding logic
            all_properly_handled_branch_codes.add(branch_code_key) # Assumes keys are already upper
            branch_to_primary_map[branch_code_key] = p_line_id_upper

    # Step 2: Iterate through all top-level lines and mark duplicates for removal
    for current_top_level_key_orig_case, current_top_level_obj in final_lines_lookup.items():
        current_top_level_id_upper = current_top_level_obj.get("id", "").upper()
        current_top_level_name_lower = current_top_level_obj.get("name", "").lower()

        # Scenario 1: The ID of this top-level entry IS a known, handled branch code.
        # Example: top-level entry with id "M1A". We know "M1A" is handled as a branch of "M1".
        if current_top_level_id_upper in all_properly_handled_branch_codes:
            primary_line_for_this_branch = branch_to_primary_map[current_top_level_id_upper]
            # If this top-level entry's ID ("M1A") is not the same as its primary line's ID ("M1"),
            # then this top-level "M1A" entry is a duplicate.
            if current_top_level_id_upper != primary_line_for_this_branch:
                keys_to_remove_from_final_lines.add(current_top_level_key_orig_case)
                # print(f"DEBUG: Marking for removal (ID '{current_top_level_id_upper}' is a handled branch of '{primary_line_for_this_branch}'): {current_top_level_key_orig_case}")
                continue

        # Scenario 2: The NAME of this top-level entry suggests it's a branch.
        # Example: top-level entry with name "M1A branch" or "M1 Trunk Section".
        # We need to extract the potential branch code from the name.
        potential_branch_code_from_name = None
        if "branch" in current_top_level_name_lower:
            name_match = re.match(r'^([MTFB]\d+[AB]?)\s*(?:branch|line)', current_top_level_name_lower, re.IGNORECASE)
            if name_match:
                potential_branch_code_from_name = name_match.group(1).upper()
        elif "trunk section" in current_top_level_name_lower:
            # For "M1 Trunk Section", the branch code is effectively "MAIN_TRUNK" for its primary "M1"
            name_match = re.match(r'^([MTFB]\d+)\s*trunk section', current_top_level_name_lower, re.IGNORECASE)
            if name_match: # If it's named like "M1 Trunk Section"
                 potential_branch_code_from_name = "MAIN_TRUNK" # This is the key we use in branches dict

        if potential_branch_code_from_name and potential_branch_code_from_name in all_properly_handled_branch_codes:
            # The name suggests a branch (e.g. "M1A" from "M1A branch", or "MAIN_TRUNK" from "M1 Trunk Section")
            # AND this branch code is known to be handled by a primary line.
            primary_line_for_this_named_branch = branch_to_primary_map[potential_branch_code_from_name]
            
            # If the current top-level entry's ID is NOT the ID of the primary line that handles this branch,
            # then this top-level entry is a duplicate.
            # (e.g. if current_top_level_id_upper is "M1A_BRANCH_DUPLICATE" and primary is "M1")
            if current_top_level_id_upper != primary_line_for_this_named_branch:
                keys_to_remove_from_final_lines.add(current_top_level_key_orig_case)
                # print(f"DEBUG: Marking for removal (Name '{current_top_level_name_lower}' suggests handled branch '{potential_branch_code_from_name}' of '{primary_line_for_this_named_branch}'): {current_top_level_key_orig_case}")

    for key_to_del in keys_to_remove_from_final_lines:
        if key_to_del in final_lines_lookup:
            # print(f"DEBUG: Removing duplicate line entry '{key_to_del}' (ID: {final_lines_lookup[key_to_del].get('id')}, Name: {final_lines_lookup[key_to_del].get('name')}) from final_lines_lookup.")
            del final_lines_lookup[key_to_del]
    # --- END OF MORE ROBUST CLEANUP LOGIC ---

    for station_data_val in final_stations_lookup.values(): # Renamed station_data to station_data_val
        station_data_val["lines"] = set() 

    for line_obj in final_lines_lookup.values():
        line_id_upper = line_obj["id"].upper()
        line_type_val = line_obj.get("type") # Renamed line_type to line_type_val
        station_ids_in_line = set(line_obj.get("stations", []))
        for branch_stations_list in line_obj.get("branches", {}).values():
            station_ids_in_line.update(branch_stations_list)
        for s_id in station_ids_in_line:
            if s_id in final_stations_lookup:
                final_stations_lookup[s_id]["lines"].add(line_id_upper)
                current_station_type = final_stations_lookup[s_id].get("type")
                new_type_candidate = (line_type_val + " Station" if line_type_val == "Metro" 
                                      else line_type_val + " Stop" if line_type_val == "Tram" 
                                      else line_type_val + " Station" if line_type_val 
                                      else "Station") 
                type_priority = {"Metro Station": 1, "Suburban Rail Station": 2, "Tram Stop": 3, "Funicular Station": 4, "BRT Station": 5}
                if current_station_type is None or \
                   (type_priority.get(new_type_candidate, 99) < type_priority.get(current_station_type, 99)):
                    final_stations_lookup[s_id]["type"] = new_type_candidate

    final_stations_list = []
    for station_data_val_loop in final_stations_lookup.values(): # Renamed station_data to station_data_val_loop
        station_data_val_loop["lines"] = sorted(list(station_data_val_loop["lines"]))
        rail_transfers = {
            t for t in station_data_val_loop.get("transfers", set()) 
            if t in KNOWN_LINE_CODES_MASTER and t not in station_data_val_loop["lines"]
        }
        station_data_val_loop["isInterchange"] = len(station_data_val_loop["lines"]) > 1 or len(rail_transfers) > 0
        station_data_val_loop["transfers"] = sorted(list(station_data_val_loop.get("transfers", set())))
        final_stations_list.append(station_data_val_loop)
        
    return {"stations": final_stations_list, "lines": list(final_lines_lookup.values())}

def process_single_type(type_key_arg, source_info_arg, args_arg, available_md_sources_arg):
    """
    Processes a single type:
    1. Parses its MD file.
    2. Saves raw parsed data to {type}_data.json.
    3. Consolidates this data and saves to consolidated_{type}_data.json.
    """
    md_filepath = os.path.join(args_arg.md_dir.rstrip('/'), source_info_arg["path_fragment"])
    default_line_type = source_info_arg["default_type"]
    
    # --- 1. Parse MD and generate {type}_data.json ---
    ALL_PARSED_STATIONS_MASTER.clear()
    KNOWN_LINE_CODES_MASTER.clear()
    # parse_single_markdown_file will populate KNOWN_LINE_CODES_MASTER from H3s in this MD

    print(f"\n--- Parsing MD for individual type: {type_key_arg} from {md_filepath} ---")
    lines_from_current_md_dict = parse_single_markdown_file(md_filepath, default_line_type)
    
    type_specific_stations = []
    for station_id, station_data in ALL_PARSED_STATIONS_MASTER.items():
        station_data_copy = station_data.copy()
        station_data_copy["lines"] = sorted(list(station_data_copy.get("lines", set())))
        station_data_copy["transfers"] = sorted(list(station_data_copy.get("transfers", set())))
        type_specific_stations.append(station_data_copy)

    type_specific_lines_list = []
    for line_id, line_info_md in lines_from_current_md_dict.items(): # Renamed line_info to line_info_md
         line_info_copy = line_info_md.copy()
         line_info_copy['type'] = default_line_type
         type_specific_lines_list.append(line_info_copy)

    type_data_filename = f"{type_key_arg}_data.json"
    # Ensure output directory exists, use dirname of args_arg.output_json
    output_dir = os.path.dirname(args_arg.output_json) # This should be ../data/
    if not os.path.exists(output_dir) and output_dir: # Create if not exists and not empty
        os.makedirs(output_dir)
    type_data_output_path = os.path.join(output_dir, type_data_filename)
    
    type_specific_json_content = {
        "stations": type_specific_stations,
        "lines": type_specific_lines_list
    }
    
    try:
        with open(type_data_output_path, 'w', encoding='utf-8') as f:
            json.dump(type_specific_json_content, f, ensure_ascii=False, indent=2)
        print(f"Saved raw parsed data for type '{type_key_arg}' to '{type_data_output_path}'.")
    except IOError as e:
        print(f"Error writing raw parsed data for type '{type_key_arg}' to '{type_data_output_path}': {e}")
        return # Stop processing this type if cannot write its data file

    # --- 2. Consolidate for this type using its own _data.json as base ---
    print(f"\n--- Consolidating data for type: {type_key_arg} ---")
    current_base_json_path = type_data_output_path
    consolidated_output_filename = f"consolidated_{type_key_arg}_data.json"
    current_output_json_path = os.path.join(output_dir, consolidated_output_filename)

    base_data_for_type = {}
    try:
        with open(current_base_json_path, 'r', encoding='utf-8') as f:
            base_data_for_type = json.load(f)
        print(f"Successfully loaded base data for type '{type_key_arg}' from '{current_base_json_path}'.")
    except FileNotFoundError:
        print(f"Base JSON file '{current_base_json_path}' (created from MD) not found. This is unexpected. Starting with an empty dataset for consolidation.")
        base_data_for_type = {"stations": [], "lines": []}
    except json.JSONDecodeError:
        print(f"Error decoding base JSON from '{current_base_json_path}'. Starting empty.")
        base_data_for_type = {"stations": [], "lines": []}
    
    # ALL_PARSED_STATIONS_MASTER is already set correctly from the parse_single_markdown_file call above
    # KNOWN_LINE_CODES_MASTER was also populated by parse_single_markdown_file with lines from this MD.
    # This is the correct context for merge_and_finalize_data for a single type.
    
    final_output_for_type = merge_and_finalize_data(
        base_data_for_type,
        {default_line_type: lines_from_current_md_dict}
    )
    
    try:
        with open(current_output_json_path, 'w', encoding='utf-8') as f:
            json.dump(final_output_for_type, f, ensure_ascii=False, indent=2)
        print(f"Saved consolidated data for type '{type_key_arg}' to '{current_output_json_path}'.")
        print(f"  Total stations: {len(final_output_for_type.get('stations', []))}")
        print(f"  Total lines: {len(final_output_for_type.get('lines', []))}")
    except IOError as e:
        print(f"Error writing consolidated data for type '{type_key_arg}' to '{current_output_json_path}': {e}")

def main():
    parser = argparse.ArgumentParser(description="Consolidate Istanbul rail network data from MD files into a single JSON.")
    parser.add_argument(
        "--types",
        type=str,
        default="all",
        help="Comma-separated list of line types to process (e.g., 'metro,tram' or 'all'). Default is 'all'."
    )
    parser.add_argument(
        "--base_json",
        type=str,
        default="data/system_data.json",
        help="Path to the base JSON file to update (used when --types=all). If not found, starts fresh."
    )
    parser.add_argument(
        "--output_json",
        type=str,
        default="data/consolidated_system_data.json",
        help="Path to save the final consolidated JSON file (used when --types=all, also defines output dir for specific types)."
    )
    parser.add_argument(
        "--md_dir",
        type=str,
        default="data/md_sources/",
        help="Directory containing the Markdown source files (e.g., metro.md, tram.md)."
    )
    args = parser.parse_args()

    AVAILABLE_MD_SOURCES = {
        "metro": {"path_fragment": "metro_data.md", "default_type": "Metro"},
        "tram": {"path_fragment": "tram_data.md", "default_type": "Tram"},
        "marmaray": {"path_fragment": "marmaray_data.md", "default_type": "Suburban Rail"},
        "funicular": {"path_fragment": "funicular_data.md", "default_type": "Funicular"},
    }

    types_to_process_str = args.types.lower()

    if types_to_process_str != "all":
        selected_types = [t.strip() for t in types_to_process_str.split(',')]
        print(f"Processing specific types: {selected_types}")
        for type_key in selected_types:
            if type_key in AVAILABLE_MD_SOURCES:
                source_info = AVAILABLE_MD_SOURCES[type_key]
                process_single_type(type_key, source_info, args, AVAILABLE_MD_SOURCES)
            else:
                print(f"Warning: Unknown type '{type_key}' specified in --types. Ignoring.")
        print("\nIndividual type processing complete.")
        return # Exit after individual processing
    
    # --- Logic for "--types all" (original behavior) ---
    print("Processing all types as per 'all' or default.")
    md_sources_to_process_all = [] # Renamed to avoid conflict
    for type_key, source_info in AVAILABLE_MD_SOURCES.items():
        md_sources_to_process_all.append({ # Use the new list name
            "path": os.path.join(args.md_dir.rstrip('/'), source_info["path_fragment"]),
            "default_type": source_info["default_type"]
        })

    if not md_sources_to_process_all: # Check the new list name
        print("No MD sources defined in AVAILABLE_MD_SOURCES. Exiting.")
        return

    # 1. Load base JSON for "all" mode
    base_line_colors = None
    consolidated_data = {"stations": [], "lines": []} # Default if file not found or error
    try:
        with open(args.base_json, 'r', encoding='utf-8') as f:
            consolidated_data = json.load(f)
        print(f"Successfully loaded base data from '{args.base_json}' for 'all' mode.")
        if "line_colors" in consolidated_data:
            base_line_colors = consolidated_data["line_colors"]
            print("  Found 'line_colors' in base data. Will preserve.")
        # Populate KNOWN_LINE_CODES_MASTER from the base JSON for "all" mode
        KNOWN_LINE_CODES_MASTER.clear() # Start fresh for "all" mode context
        for line_obj in consolidated_data.get("lines", []):
            KNOWN_LINE_CODES_MASTER.add(line_obj["id"].upper())
            for branch_key in line_obj.get("branches", {}).keys():
                 KNOWN_LINE_CODES_MASTER.add(branch_key.upper())
    except FileNotFoundError:
        print(f"Base JSON file '{args.base_json}' not found for 'all' mode. Starting with an empty dataset.")
    except json.JSONDecodeError:
        print(f"Error decoding base JSON from '{args.base_json}' for 'all' mode. Starting empty.")

    # 2. Process each MD file for "all" mode, accumulating data
    all_md_parsed_lines_by_type = {}
    ALL_PARSED_STATIONS_MASTER.clear() # Ensure fresh accumulation for "all" mode

    for source in md_sources_to_process_all: # Iterate over the new list name
        print(f"\n--- Processing MD source for 'all' mode: {source['path']} (Type: {source['default_type']}) ---")
        # parse_single_markdown_file will add to global ALL_PARSED_STATIONS_MASTER
        # and global KNOWN_LINE_CODES_MASTER
        parsed_lines_from_current_md = parse_single_markdown_file(source['path'], source['default_type'])
        
        current_type_lines = all_md_parsed_lines_by_type.setdefault(source['default_type'], {})
        for line_id, line_info_val in parsed_lines_from_current_md.items(): # Renamed line_info to line_info_val
            line_info_val['type'] = source['default_type']
            current_type_lines[line_id] = line_info_val

    # 3. Perform the final merge for "all" mode
    print("\n--- Finalizing all consolidated data for 'all' mode ---")
    # KNOWN_LINE_CODES_MASTER has been populated from base JSON and all MD files by now.
    # ALL_PARSED_STATIONS_MASTER has all stations from all MD files.
    final_output_data = merge_and_finalize_data(consolidated_data, all_md_parsed_lines_by_type)

    if base_line_colors is not None:
        final_output_data["line_colors"] = base_line_colors
        print("  'line_colors' has been re-added to the final output for 'all' mode.")

    # 4. Save for "all" mode
    output_dir_all = os.path.dirname(args.output_json)
    if not os.path.exists(output_dir_all) and output_dir_all:
        os.makedirs(output_dir_all)
    try:
        with open(args.output_json, 'w', encoding='utf-8') as f:
            json.dump(final_output_data, f, ensure_ascii=False, indent=2)
        print(f"\nFully consolidated data for 'all' mode saved to '{args.output_json}'.")
        print(f"  Total stations: {len(final_output_data.get('stations', []))}")
        print(f"  Total lines: {len(final_output_data.get('lines', []))}")
        if "line_colors" in final_output_data:
            print(f"  'line_colors' object is present in the output.")
    except IOError as e:
        print(f"Error writing final consolidated data for 'all' mode to '{args.output_json}': {e}")

if __name__ == "__main__":
    main()