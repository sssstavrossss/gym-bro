# Gym Bro design prototype

This folder is an interactive design prototype for Gym Bro. It is not production code.

It is a Vue 3.5 + Vite app with strict TypeScript. The example profile, weigh-ins, foods, and food log are fictional (`src/data/seed.ts`, `src/data/foods.ts`). Nothing is sent to a server. The prototype stores that data in the browser only, in `localStorage`. Profile has a control to reset the example data.

The app in `frontend/` follows this prototype. Later changes to the product UI should match the screens and behaviour here. `backend/` and `frontend/` are the product. This folder is the design source of truth, and it is not part of the Docker image.

## Run

From this directory:

```bash
npm ci && npm run dev
```

Vite serves it at <http://localhost:5174>.

`npm run build` typechecks the project and writes the production build. Root CI keeps the required `tests` job focused on the product. A separate `prototype` job runs `npm ci && npm run build` in this folder only.
