// MIT Copyright (c) 2026 Lovecast Inc. Local class-name joiner for the
// automations feature (clsx + tailwind-merge, mirroring the shared button).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}
