# Explorer: OpenStreetMap + Weatherbit + TomTom

A lightweight, static web app that displays an OpenStreetMap map (via Leaflet), shows current weather from Weatherbit for the selected location, and lists nearby points-of-interest using TomTom Search.

## Quick Start

1) Copy `config.example.js` to `config.js` and add your API keys:

```
cp config.example.js config.js
```

Then edit `config.js` and set:

```
window.APP_CONFIG = {
	WEATHERBIT_API_KEY: "YOUR_WEATHERBIT_API_KEY",
	TOMTOM_API_KEY: "YOUR_TOMTOM_API_KEY",
};
```

2) Run a local static server (recommended for geolocation). Pick one option:

- VS Code: install the "Live Server" extension, then open `index.html` with Live Server.
- Node (no install):

```powershell
npx serve . -p 5173
```

- Node (http-server):

```powershell
npx http-server -p 5173
```

- Python 3:

```powershell
python -m http.server 5173
```

Open http://localhost:5173 and use the app.

## Features

- OpenStreetMap map via Leaflet (no API key)
- Weatherbit current weather for selected coordinates
- TomTom Search results by category around the current map location
- “Use My Location” shortcut with graceful fallback

## Usage

- Search a place using the top input (OpenStreetMap/Nominatim). Press Enter to search; the map recenters and weather updates.
- Click 📍 to use your current location (HTTPS/localhost required for geolocation).
- Choose a POI category and click "Find Nearby" to fetch TomTom results; markers are added to the map and a list appears in the sidebar.

## Getting API Keys (Free Tiers)

- Weatherbit (Current Weather API): https://www.weatherbit.io/account/create
- TomTom Search API: https://developer.tomtom.com/

OpenStreetMap tiles are free to use with attribution via Leaflet defaults. Geocoding uses Nominatim; please respect usage policy and rate limits.

Important: Restrict your keys in each provider’s console (HTTP referrers for JS keys). Keep `config.js` private; this repo ignores it via `.gitignore`.

## Notes

- This is a static site — no backend required. Keys are used client-side; always domain-restrict them.
- If the map fails to load, check your network or CDN availability for Leaflet and OSM tiles.
- Weatherbit free tier may rate-limit; errors will show a generic failure message.
- TomTom search can be tuned with different queries or `radius`/`limit` in `js/main.js`.

## Project Structure

```
index.html
styles.css
config.example.js
config.js        # (created by you, ignored by git)
js/
	main.js
```

## License

This project is provided as-is for demo purposes.
