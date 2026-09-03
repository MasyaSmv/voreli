// Nest's DI and class-validator read decorator metadata through the reflect-metadata
// polyfill; production loads it in main.ts, tests never reach that entry point.
import "reflect-metadata";
