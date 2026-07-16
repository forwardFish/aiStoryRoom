export type TransactionalEmailInput = {
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  introduction: string;
  actionLabel: string;
  actionUrl: string;
  followUp: string;
  securityNotice: string;
  supportEmail?: string;
};

export type TransactionalEmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

export function buildTransactionalEmail(input: TransactionalEmailInput): TransactionalEmailTemplate {
  const actionUrl = requireHttpUrl(input.actionUrl);
  const siteOrigin = new URL(actionUrl).origin;
  const supportEmail = normalizeSupportEmail(input.supportEmail);
  const supportLink = `mailto:${supportEmail}`;
  const privacyUrl = `${siteOrigin}/privacy`;
  const termsUrl = `${siteOrigin}/terms`;
  const year = new Date().getUTCFullYear();

  const text = [
    "MANY WORLDS",
    input.title,
    "",
    input.introduction,
    "",
    `${input.actionLabel}:`,
    actionUrl,
    "",
    input.followUp,
    "",
    `SECURITY NOTICE: ${input.securityNotice}`,
    "Many Worlds will never ask you to send your password or this secure link by email.",
    "",
    `Need help? Contact ${supportEmail}`,
    "",
    `© ${year} Many Worlds. All rights reserved.`
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title>${escapeHtml(input.subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-content { padding: 34px 24px 30px !important; }
        .email-header { padding: 22px 24px !important; }
        .email-title { font-size: 30px !important; line-height: 1.18 !important; }
        .email-button { display: block !important; padding: 16px 20px !important; }
        .email-footer { padding-left: 20px !important; padding-right: 20px !important; }
      }
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5fb;color:#111a36;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(input.preheader)}&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4f5fb;">
      <tr>
        <td align="center" style="padding:42px 16px 24px;">
          <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e5ef;border-radius:20px;overflow:hidden;box-shadow:0 18px 55px rgba(29,23,63,0.10);">
            <tr><td height="6" bgcolor="#6636d8" style="height:6px;font-size:0;line-height:0;background:linear-gradient(90deg,#4c2bd9 0%,#7439df 58%,#10bde0 100%);">&nbsp;</td></tr>
            <tr>
              <td class="email-header" style="padding:25px 40px;border-bottom:1px solid #eceef5;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="54" valign="middle" style="width:54px;">
                      <div aria-hidden="true" style="display:block;width:44px;height:44px;border-radius:50%;background-color:#6636d8;color:#ffffff;font-size:15px;line-height:44px;font-weight:900;letter-spacing:-0.03em;text-align:center;">MW</div>
                    </td>
                    <td valign="middle" style="padding-left:2px;">
                      <div style="font-size:21px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;color:#171f3b;">Many Worlds</div>
                      <div style="padding-top:4px;font-size:12px;line-height:1.25;color:#77809a;">Official account message</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-content" style="padding:46px 48px 40px;">
                <div style="font-size:13px;line-height:1.3;font-weight:800;letter-spacing:0.12em;color:#6b3bd7;">${escapeHtml(input.eyebrow)}</div>
                <h1 class="email-title" style="margin:14px 0 18px;font-size:38px;line-height:1.16;letter-spacing:-0.035em;color:#111a36;font-weight:800;">${escapeHtml(input.title)}</h1>
                <p style="margin:0;color:#5f6a85;font-size:17px;line-height:1.65;">${escapeHtml(input.introduction)}</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:30px 0 26px;">
                  <tr>
                    <td align="center" bgcolor="#6636d8" style="border-radius:12px;background:linear-gradient(105deg,#5b31d4,#753ce1);box-shadow:0 12px 24px rgba(102,54,216,0.24);">
                      <a class="email-button" href="${escapeHtml(actionUrl)}" target="_blank" style="display:inline-block;width:100%;box-sizing:border-box;padding:17px 28px;color:#ffffff;font-size:17px;line-height:1.2;font-weight:800;text-align:center;text-decoration:none;border-radius:12px;">${escapeHtml(input.actionLabel)}</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 26px;color:#5f6a85;font-size:15px;line-height:1.65;">${escapeHtml(input.followUp)}</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f5f2ff;border:1px solid #e5ddfb;border-radius:14px;">
                  <tr>
                    <td style="padding:21px 22px;">
                      <div style="margin-bottom:6px;color:#2b2451;font-size:13px;line-height:1.3;font-weight:800;letter-spacing:0.04em;">SECURITY NOTICE</div>
                      <div style="color:#655f79;font-size:14px;line-height:1.6;">${escapeHtml(input.securityNotice)} Many Worlds will never ask you to send your password or this secure link by email.</div>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:28px;padding-top:24px;border-top:1px solid #eceef5;">
                  <p style="margin:0 0 8px;color:#7a839a;font-size:12px;line-height:1.55;">If the button does not work, copy and paste this secure link into your browser:</p>
                  <p style="margin:0;word-break:break-all;color:#6336cf;font-size:12px;line-height:1.55;"><a href="${escapeHtml(actionUrl)}" target="_blank" style="color:#6336cf;text-decoration:underline;">${escapeHtml(actionUrl)}</a></p>
                </div>
              </td>
            </tr>
          </table>

          <table role="presentation" class="email-shell email-footer" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
            <tr>
              <td align="center" style="padding:25px 30px 12px;color:#7d859a;font-size:12px;line-height:1.7;">
                This is an automated account message from Many Worlds.<br>
                Need help? <a href="${escapeHtml(supportLink)}" style="color:#6235d2;text-decoration:none;font-weight:700;">${escapeHtml(supportEmail)}</a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 30px;color:#9299aa;font-size:11px;line-height:1.7;">
                <a href="${escapeHtml(privacyUrl)}" style="color:#777f93;text-decoration:underline;">Privacy Policy</a>
                &nbsp;&nbsp;·&nbsp;&nbsp;
                <a href="${escapeHtml(termsUrl)}" style="color:#777f93;text-decoration:underline;">Terms of Service</a><br>
                © ${year} Many Worlds. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: input.subject, text, html };
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

function requireHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Transactional email action URL must use http or https");
  return url.toString();
}

function normalizeSupportEmail(value: string | undefined) {
  const email = String(value || "support@ourmanyworlds.com").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "support@ourmanyworlds.com";
}
