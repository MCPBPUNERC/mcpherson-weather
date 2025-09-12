# McPherson, KS — Live Weather

- **Primary:** private KWCH feed for ZIP **67460** (set `KWCH_WEATHER_JSON_URL`)
- **Fallback:** NWS nearest station to **17th Ave** in McPherson
- UI shows no provider branding
- Fetches immediately; refreshes ~1/min
- Hourly snapshots at top of each hour (localStorage)
- Copy TSV (current) and Copy/Download CSV (hourly log)

## Local
```bash
npm install
cp .env.sample .env   # (optional) add your KWCH_WEATHER_JSON_URL
npm start
# open http://localhost:3000
