const PAYSTACK_BASE_URL = "https://api.paystack.co";

export function getPaystackSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  return key;
}

export async function initializePaystackTransaction(payload) {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getPaystackSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) {
    throw new Error(data?.message || "Failed to initialize payment");
  }

  return data.data;
}

export async function verifyPaystackTransaction(reference) {
  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
      },
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) {
    throw new Error(data?.message || "Failed to verify payment");
  }

  return data.data;
}
