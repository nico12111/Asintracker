import type { AmazonProvider, ComparisonProvider } from "../types";
import { keepaProvider } from "./keepa";
import { idealoProvider } from "./idealo";
import { billigerProvider } from "./billiger";

export const amazonProvider: AmazonProvider = keepaProvider;

export const comparisonProviders: ComparisonProvider[] = [
  idealoProvider,
  billigerProvider,
];

export { keepaProvider, idealoProvider, billigerProvider };
