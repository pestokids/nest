/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as activities from "../activities.js";
import type * as agents from "../agents.js";
import type * as agentsSchema from "../agentsSchema.js";
import type * as auth from "../auth.js";
import type * as closeSchema from "../closeSchema.js";
import type * as closings from "../closings.js";
import type * as crons from "../crons.js";
import type * as drafts from "../drafts.js";
import type * as draftsSchema from "../draftsSchema.js";
import type * as enrich from "../enrich.js";
import type * as enrichSchema from "../enrichSchema.js";
import type * as google from "../google.js";
import type * as googleOAuth from "../googleOAuth.js";
import type * as googleSync from "../googleSync.js";
import type * as http from "../http.js";
import type * as investors from "../investors.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_agentKey from "../lib/agentKey.js";
import type * as lib_anthropic from "../lib/anthropic.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_draftPrompt from "../lib/draftPrompt.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_enrichQueue from "../lib/enrichQueue.js";
import type * as lib_enums from "../lib/enums.js";
import type * as lib_googleApi from "../lib/googleApi.js";
import type * as lib_jsonSchema from "../lib/jsonSchema.js";
import type * as lib_mapLimit from "../lib/mapLimit.js";
import type * as lib_noteRead from "../lib/noteRead.js";
import type * as lib_notesPrompt from "../lib/notesPrompt.js";
import type * as lib_pace from "../lib/pace.js";
import type * as lib_research from "../lib/research.js";
import type * as lib_round from "../lib/round.js";
import type * as lib_token from "../lib/token.js";
import type * as materials from "../materials.js";
import type * as materialsSchema from "../materialsSchema.js";
import type * as mcp from "../mcp.js";
import type * as mcpHttp from "../mcpHttp.js";
import type * as noteReads from "../noteReads.js";
import type * as notesSchema from "../notesSchema.js";
import type * as prefs from "../prefs.js";
import type * as prep from "../prep.js";
import type * as qanda from "../qanda.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as suggestions from "../suggestions.js";
import type * as validators from "../validators.js";
import type * as viewer from "../viewer.js";
import type * as viewerHttp from "../viewerHttp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  activities: typeof activities;
  agents: typeof agents;
  agentsSchema: typeof agentsSchema;
  auth: typeof auth;
  closeSchema: typeof closeSchema;
  closings: typeof closings;
  crons: typeof crons;
  drafts: typeof drafts;
  draftsSchema: typeof draftsSchema;
  enrich: typeof enrich;
  enrichSchema: typeof enrichSchema;
  google: typeof google;
  googleOAuth: typeof googleOAuth;
  googleSync: typeof googleSync;
  http: typeof http;
  investors: typeof investors;
  "lib/access": typeof lib_access;
  "lib/agentKey": typeof lib_agentKey;
  "lib/anthropic": typeof lib_anthropic;
  "lib/crypto": typeof lib_crypto;
  "lib/draftPrompt": typeof lib_draftPrompt;
  "lib/email": typeof lib_email;
  "lib/enrichQueue": typeof lib_enrichQueue;
  "lib/enums": typeof lib_enums;
  "lib/googleApi": typeof lib_googleApi;
  "lib/jsonSchema": typeof lib_jsonSchema;
  "lib/mapLimit": typeof lib_mapLimit;
  "lib/noteRead": typeof lib_noteRead;
  "lib/notesPrompt": typeof lib_notesPrompt;
  "lib/pace": typeof lib_pace;
  "lib/research": typeof lib_research;
  "lib/round": typeof lib_round;
  "lib/token": typeof lib_token;
  materials: typeof materials;
  materialsSchema: typeof materialsSchema;
  mcp: typeof mcp;
  mcpHttp: typeof mcpHttp;
  noteReads: typeof noteReads;
  notesSchema: typeof notesSchema;
  prefs: typeof prefs;
  prep: typeof prep;
  qanda: typeof qanda;
  seed: typeof seed;
  settings: typeof settings;
  suggestions: typeof suggestions;
  validators: typeof validators;
  viewer: typeof viewer;
  viewerHttp: typeof viewerHttp;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
