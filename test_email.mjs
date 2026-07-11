// 模拟 env，测试 sendEmail 函数是否能正常调用 Resend API
async function sendEmail(env, { to, subject, html, text }) {
  const fromEmail = env.FROM_EMAIL || env.ADMIN_EMAIL || "noreply@pansan.cc";
  const recipients = Array.isArray(to) ? to : [to];
  console.log(`[EMAIL] Sending email via=${env.RESEND_API_KEY ? "resend" : "console"} to=${recipients.join(", ")} subject=${subject}`);

  if (env.RESEND_API_KEY) {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject,
        html,
        text
      })
    });
    const respText = await resp.text().catch(() => "");
    console.log(`[EMAIL] Resend response status=${resp.status} body=${respText.slice(0, 500)}`);
    if (!resp.ok) {
      throw new Error(`Email send failed: ${resp.status} ${respText}`);
    }
    return { sent: true, via: "resend", response: respText };
  }

  console.log(`[DEV] Email to ${recipients.join(", ")}: ${subject}`);
  return { sent: false, via: "console" };
}

// 测试时需要填入真实的 RESEND_API_KEY
// 注意：直接在这里 hardcode 会暴露到代码仓库，仅用于本地测试
const env = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  ADMIN_EMAIL: "zp1364625224@163.com",
  FROM_EMAIL: "noreply@pansan.cc"
};

(async () => {
  if (!env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set in env. Set it via: $env:RESEND_API_KEY='re_xxxxx'; node test_email.mjs");
    process.exit(1);
  }
  try {
    const result = await sendEmail(env, {
      to: env.ADMIN_EMAIL,
      subject: "【PanSan】本地测试邮件",
      html: "<p>这是一封测试邮件</p>"
    });
    console.log("SUCCESS:", result);
  } catch (e) {
    console.error("FAILED:", e.message);
  }
})();
