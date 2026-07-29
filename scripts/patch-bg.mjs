import fs from "fs";
const p = "D:/Desktop/Boss海投助手/extension/background/service-worker.js";
let s = fs.readFileSync(p, "utf8");
const re = /const chatRes = await sendToBoss\(MSG\.START_CHAT, \{ job \}\);\r?\n  if \(!chatRes\?\.ok\) \{[\s\S]*?return 'failed';\r?\n  \}/;
const rep = `const chatRes = await sendToBoss(MSG.START_CHAT, { job });
  if (!chatRes?.ok) {
    item.state = 'FAILED';
    let code = REASON.EXEC_CLICK_FAIL;
    if (chatRes?.error === 'CHAT_TIMEOUT') code = REASON.EXEC_CHAT_TIMEOUT;
    if (chatRes?.error === 'LOGIN_REQUIRED') code = REASON.LIMIT_PLATFORM;
    item.reasons = [reasonText(code, chatRes?.message || chatRes?.error || '')];
    task.counters.failed += 1;
    task.consecutiveFails += 1;
    await bumpDailyStat('fail');
    await log('error', \`沟通失败：\${item.reasons[0]}\`, { jobId: job.jobId });
    if (chatRes?.error === 'LOGIN_REQUIRED') {
      runner.pause = true;
      task.status = TASK_STATUS.PAUSED;
      task.pauseReason = chatRes.message || '需要登录';
      await publishTask(task);
      return 'limited';
    }
    return 'failed';
  }
  if (chatRes.securityId) job.securityId = chatRes.securityId;
  if (chatRes.detailSalary && !job.salary) job.salary = chatRes.detailSalary;`;
if (!re.test(s)) {
  console.error("pattern not found");
  process.exit(1);
}
s = s.replace(re, rep);
fs.writeFileSync(p, s);
console.log("bg chat block patched");