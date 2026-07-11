// MailChannels 发送邮件（Cloudflare Workers 原生集成）
// 文档：https://blog.cloudflare.com/mailchannels/
async function sendEmailViaMailChannels(env, { to, subject, html, text }) {
  const fromEmail = "noreply@pansanrequest.ccwu.cc";
  const recipients = Array.isArray(to) ? to : [to];
  console.log(`[EMAIL-MC] Sending to=${recipients.join(", ")} subject=${subject}`);

  const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map(email => ({ email })) }],
      from: { email: fromEmail, name: "PanSan报价系统" },
      subject,
      content: [
        { type: "text/plain", value: text || html.replace(/<[^>]+>/g, "") },
        { type: "text/html", value: html }
      ]
    })
  });

  const respText = await resp.text().catch(() => "");
  console.log(`[EMAIL-MC] Response status=${resp.status} body=${respText.slice(0, 500)}`);

  if (!resp.ok) {
    throw new Error(`MailChannels send failed: ${resp.status} ${respText}`);
  }
  return { sent: true, via: "mailchannels", response: respText };
}
