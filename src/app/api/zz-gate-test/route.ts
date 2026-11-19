// TEST ONLY — gate FAIL demo (UMAIR item 5). DO NOT MERGE. Delete with the branch.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "test route — do not merge" }, { status: 501 });
}
