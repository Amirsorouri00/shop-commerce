// Server entry point.  Run:  npm start
import { startServer } from './api.ts';
startServer(Number(process.env.PORT ?? 3000));
