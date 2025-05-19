from bs4 import BeautifulSoup
import json
import re

def extract_station_coordinates_from_svg(svg_filepath):
    """
    Extracts station coordinates (id, x, y, fill) from <rect> elements in an SVG file.
    """
    coordinates = {}
    try:
        with open(svg_filepath, 'r', encoding='utf-8') as f:
            svg_content = f.read()
    except FileNotFoundError:
        print(f"Error: SVG file not found at {svg_filepath}")
        return None
    except Exception as e:
        print(f"Error reading SVG file: {e}")
        return None

    soup = BeautifulSoup(svg_content, 'xml') # Use 'xml' parser for SVG

    # Find all <rect> elements that have an 'id' attribute
    # We can also look for rects within specific <g id="M..."> groups if needed
    # For now, let's find all rects with an id, assuming they are stations.
    
    station_rects = soup.find_all('rect', id=True)

    if not station_rects:
        print("No <rect> elements with an 'id' attribute found. Are stations represented differently?")
        # Alternative: Look within known group IDs if top-level rects fail
        # For example, if you know lines are in <g id="M1">, <g id="M2">, etc.
        line_groups = soup.find_all('g', id=lambda x: x and x.startswith('M')) # Find groups like M1, M2...
        if line_groups:
            print("Found line groups. Searching for rects within them...")
            for group in line_groups:
                rects_in_group = group.find_all('rect', id=True)
                station_rects.extend(rects_in_group) # Add to the list
            if not station_rects:
                 print("Still no <rect> elements with 'id' found within line groups.")
                 return {} # Return empty if truly none found
        else:
            return {}


    print(f"Found {len(station_rects)} <rect> elements with an 'id'. Extracting data...")

    for rect in station_rects:
        station_id = rect.get('id')
        x_val = rect.get('x')
        y_val = rect.get('y')
        fill_color = rect.get('fill')
        # width = rect.get('width') # You can also extract width/height if needed
        # height = rect.get('height')

        if station_id and x_val is not None and y_val is not None:
            try:
                # Convert x and y to numbers (float or int)
                # SVG coordinates can sometimes be floats
                x_coord = float(x_val)
                y_coord = float(y_val)
                
                coordinates[station_id] = {
                    "x": x_coord,
                    "y": y_coord,
                    "figmaFill": fill_color if fill_color else "#000000" # Default if no fill
                }
            except ValueError:
                print(f"Warning: Could not convert x ('{x_val}') or y ('{y_val}') to number for station ID: {station_id}. Skipping.")
        else:
            print(f"Warning: Missing id, x, or y for a <rect> element: {rect.prettify()[:100]}...")
            
    return coordinates

if __name__ == "__main__":
    svg_input_file = "trace.svg"  # <--- IMPORTANT: SET THIS TO YOUR SVG FILE NAME
    json_output_file = "figma_coordinates.json"

    extracted_data = extract_station_coordinates_from_svg(svg_input_file)

    if extracted_data is not None:
        if extracted_data: # Check if any data was actually extracted
            try:
                with open(json_output_file, 'w', encoding='utf-8') as f:
                    json.dump(extracted_data, f, indent=2, ensure_ascii=False)
                print(f"\nSuccessfully extracted {len(extracted_data)} station coordinates.")
                print(f"Data saved to: {json_output_file}")
                
                # Print a small sample
                sample_count = 0
                print("\nSample of extracted data:")
                for station_id, data in extracted_data.items():
                    print(f"  '{station_id}': {{ x: {data['x']}, y: {data['y']}, figmaFill: '{data['figmaFill']}' }}")
                    sample_count += 1
                    if sample_count >= 5:
                        break
            except IOError:
                print(f"Error: Could not write JSON data to {json_output_file}")
        else:
            print("No station data was extracted. The output JSON file will not be created or will be empty.")
    else:
        print("Extraction process failed.")