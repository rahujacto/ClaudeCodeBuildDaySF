/**
 * Transactional email via Resend. Optional: if RESEND_API_KEY / RESEND_FROM
 * aren't set, sending is skipped (the invite still works as an allowlist).
 */
export async function sendInviteEmail(opts: {
  to: string;
  role: string;
  inviter?: string;
  orgName?: string;
  appUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { sent: false };

  const { to, role, inviter, orgName, appUrl } = opts;
  const team = orgName || "a team";
  const subject = `You're invited to ${team} on Pulse`;
  const signIn = `${appUrl}/login`;
  const html = `
    <div style="font-family:ui-sans-serif,system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:9999px;background:#10b981"></span>
        <strong style="font-size:16px">Pulse</strong>
      </div>
      <h1 style="font-size:20px;margin:0 0 12px">You've been invited to ${team}</h1>
      <p style="font-size:14px;line-height:22px;color:#3f3f46">
        ${inviter ? `${inviter} invited you` : "You've been invited"} to join their workspace on
        <strong>Pulse</strong>, an agentic Shopify marketing manager, as a <strong>${role}</strong>.
        You'll see their connected store data with no setup.
      </p>
      <p style="font-size:14px;line-height:22px;color:#3f3f46">
        Sign in with Google using <strong>${to}</strong> to accept:
      </p>
      <p style="margin:20px 0">
        <a href="${signIn}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">
          Sign in to Pulse
        </a>
      </p>
      <p style="font-size:12px;line-height:18px;color:#a1a1aa">
        Use the same email this invite was sent to. If the button doesn't work, open ${signIn}.
      </p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { sent: false, error: detail.slice(0, 200) };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
