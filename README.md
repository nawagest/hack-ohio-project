# AEP HackOHI/O 2026 Challenge

Source datasets and reference documents for the AI Outage Concierge challenge: outage-risk prediction, restoration-time estimates, preparation guidance, and customer communications.

## Contents

- [`data/`](data/README.md): original GIS and upstream-topology archives, labor-hour workbook, and local extraction instructions.
- [`docs/HackOHIO_2026_AI_Outage_Concierge_Challenge.docx`](docs/HackOHIO_2026_AI_Outage_Concierge_Challenge.docx): challenge requirements and data-package overview.
- [`docs/structure_drawings.pdf`](docs/structure_drawings.pdf): sample distribution structure diagrams.
- [`backend/`](backend/): FastAPI service for anonymized demo data, transparent scenario calculations, and optional Ollama explanations.
- [`mobile/`](mobile/): Expo / React Native app for the customer dashboard and assistant.

## Run the prototype

Requirements: Python 3.10+, Node.js, and npm. The supplied raw data archives and labor workbook must remain in `data/`.

Start the API in one terminal:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.app.main:app --reload
```

Start the app in another terminal:

```bash
cd mobile
npm install
cp .env.example .env
npm run start
```

The default mobile API address is `http://localhost:8000`. For a physical phone, start the API with `--host 0.0.0.0`, then set `EXPO_PUBLIC_API_URL` in `mobile/.env` to the computer's reachable LAN address (for example, `http://192.168.1.20:8000`). Android emulators may need `http://10.0.2.2:8000`.

The assistant uses deterministic explanations by default. To use a local Ollama server, set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in the environment before starting the API:

```bash
set -a
source backend/.env
set +a
backend/.venv/bin/python -m uvicorn backend.app.main:app --reload
```

For a physical phone, add `--host 0.0.0.0` to the command so the phone can reach the development API over your local network.

For example, use `OLLAMA_BASE_URL=http://localhost:11434` and `OLLAMA_MODEL=llama3.2`. Ollama explains the API's calculated results; it does not calculate outage risk or restoration time.

## Prototype limits

- The backend automatically fetches National Weather Service observations, the next forecast period, and active weather alerts for each anonymized sample region. It caches successful results for 15 minutes, labels cached data after a failed refresh, flags station observations older than 90 minutes as delayed, and reports the source and retrieval/observation time. No API key is required; live data depends on NWS availability and internet access.
- Weather lookups use customer GIS circuit centers rounded to 0.1 degrees; exact customer coordinates and addresses are not sent to NWS. The supplied sample circuit geometry is in southwest Virginia, despite the challenge's Ohio branding. Confirm the correct operating area before treating these weather results as local to Ohio.
- Live weather is contextual only and does not currently change the relative outage-risk score or restoration estimate.
- Risk is a relative, rule-based index based on historical circuit damage and a user-selected simulated storm severity. It is **not an outage probability** and is not calibrated against outage outcomes.
- Restoration ranges use the supplied small-pole labor averages and 4.5 indirect-labor multiplier, with explicitly simulated crew availability and access assumptions. They are **not utility commitments**.
- The location choices are anonymized sample circuits; the app does not expose customer addresses, premise identifiers, or internal equipment identifiers.
- Outage-alert eligibility is a demo rule only; the app does not send notifications or receive live utility outage, restoration, or crew updates. Weather alerts shown in the app are official NWS alerts.
