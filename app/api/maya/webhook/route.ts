import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const MAYA_HOSTS = {
  sandbox: "https://pg-sandbox.paymaya.com",
  production: "https://pg.paymaya.com",
};

function getMayaHost() {
  return process.env.MAYA_ENVIRONMENT === "production" ? MAYA_HOSTS.production : MAYA_HOSTS.sandbox;
}

function basicAuth(key: string) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role environment variable is missing.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function retrievePayment(payload: Record<string, unknown>) {
  const secretKey = process.env.MAYA_SECRET_KEY;
  if (!secretKey) throw new Error("Maya secret key is not configured.");

  const paymentId = textValue(payload.paymentId) || textValue(payload.id) || textValue(payload.checkoutId);
  const rrn = textValue(payload.requestReferenceNumber);
  const path = paymentId
    ? `/payments/v1/payments/${encodeURIComponent(paymentId)}`
    : rrn
      ? `/payments/v1/payment-rrns/${encodeURIComponent(rrn)}`
      : null;

  if (!path) return null;

  const response = await fetch(`${getMayaHost()}${path}`, {
    headers: { Authorization: basicAuth(secretKey) },
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function paymentLooksSuccessful(payment: Record<string, unknown> | null, fallback: Record<string, unknown>) {
  const source = payment || fallback;
  const status = String(source.status || source.paymentStatus || source.eventType || "").toUpperCase();
  return status.includes("PAYMENT_SUCCESS") || status === "PAYMENT_SUCCESS" || status === "SUCCESS";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reference = textValue(payload.requestReferenceNumber);
    if (!reference) return NextResponse.json({ received: true });

    const admin = getAdminSupabase();
    const { data: order, error: orderError } = await admin
      .from("picklester_maya_orders")
      .select("id,user_id,amount,currency,status,request_reference_number")
      .eq("request_reference_number", reference)
      .single();

    if (orderError || !order) return NextResponse.json({ received: true });
    if (order.status === "paid") return NextResponse.json({ received: true, status: "already_paid" });

    const payment = (await retrievePayment(payload)) as Record<string, unknown> | null;
    const amount = numberValue(payment?.totalAmount && typeof payment.totalAmount === "object"
      ? (payment.totalAmount as Record<string, unknown>).value
      : payment?.amount);
    const currency = textValue(payment?.totalAmount && typeof payment.totalAmount === "object"
      ? (payment.totalAmount as Record<string, unknown>).currency
      : payment?.currency);
    const successful = paymentLooksSuccessful(payment, payload);
    const amountMatches = amount === null || Number(order.amount) === amount;
    const currencyMatches = !currency || currency.toUpperCase() === String(order.currency).toUpperCase();

    if (!successful || !amountMatches || !currencyMatches) {
      await admin
        .from("picklester_maya_orders")
        .update({
          status: successful ? "review" : "updated",
          maya_payment_id: textValue(payload.paymentId) || textValue(payload.id),
          webhook_payload: payload,
          maya_response: payment,
        })
        .eq("id", order.id);
      return NextResponse.json({ received: true, status: "not_fulfilled" });
    }

    const { error: fulfillError } = await admin.rpc("fulfill_picklester_maya_order", {
      order_id: order.id,
      maya_payment_id_input: textValue(payload.paymentId) || textValue(payload.id),
      webhook_payload_input: payload,
      maya_response_input: payment,
    });

    if (fulfillError) {
      return NextResponse.json({ received: true, error: fulfillError.message }, { status: 500 });
    }

    return NextResponse.json({ received: true, status: "paid" });
  } catch (error) {
    return NextResponse.json(
      { received: false, error: error instanceof Error ? error.message : "Webhook failed." },
      { status: 500 },
    );
  }
}
