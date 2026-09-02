import { NextResponse } from "next/server";
import { authRuntime } from "../../../lib/auth-runtime";

export async function POST(request: Request) {
  const runtime = authRuntime();
  try {
    const signature = request.headers.get("workos-signature");
    if (!signature) return NextResponse.json({ accepted: false }, { status: 400 });
    let event;
    try {
      event = await runtime.provider.constructWebhookEvent(
        await request.text(),
        signature,
        runtime.webhookSecret,
      );
    } catch {
      return NextResponse.json({ accepted: false }, { status: 400 });
    }

    await runtime.sessions.applyProviderSecurityEvent(event);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } finally {
    await runtime.sessions.close();
  }
}
