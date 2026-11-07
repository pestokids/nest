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
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as google from "../google.js";
import type * as googleOAuth from "../googleOAuth.js";
import type * as googleSync from "../googleSync.js";
import type * as http from "../http.js";
import type * as investors from "../investors.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_enums from "../lib/enums.js";
import type * as lib_googleApi from "../lib/googleApi.js";
import type * as lib_mapLimit from "../lib/mapLimit.js";
import type * as lib_round from "../lib/round.js";
import type * as prefs from "../prefs.js";
import type * as prep from "../prep.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as suggestions from "../suggestions.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  activities: typeof activities;
  auth: typeof auth;
  crons: typeof crons;
  google: typeof google;
  googleOAuth: typeof googleOAuth;
  googleSync: typeof googleSync;
  http: typeof http;
  investors: typeof investors;
  "lib/access": typeof lib_access;
  "lib/crypto": typeof lib_crypto;
  "lib/enums": typeof lib_enums;
  "lib/googleApi": typeof lib_googleApi;
  "lib/mapLimit": typeof lib_mapLimit;
  "lib/round": typeof lib_round;
  prefs: typeof prefs;
  prep: typeof prep;
  seed: typeof seed;
  settings: typeof settings;
  suggestions: typeof suggestions;
  validators: typeof validators;
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
