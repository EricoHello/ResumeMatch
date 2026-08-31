import "server-only";

import { NextResponse } from "next/server";

export const MAINTENANCE_MESSAGE =
  "ResumeMatch is currently in development. Please check back soon.";

export function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE === "true";
}

export function maintenanceResponse() {
  return NextResponse.json(
    {
      error: {
        code: "MAINTENANCE_MODE",
        message: MAINTENANCE_MESSAGE,
      },
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
