import { NextResponse } from "next/server";
import { getGateway } from "@/lib/conversation";

export async function GET() {
  const status = getGateway().getStatus();
  return NextResponse.json(status, { status: 200 });
}
