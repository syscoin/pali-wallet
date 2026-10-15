// Keep incomplete legacy summaries from being rendered as successful runs.
function summaryReportIcon(summary) {
  if (summary?.status === 'running') return '⏳';
  const completed =
    typeof summary?.endedAt === 'string' &&
    Number.isFinite(Date.parse(summary.endedAt));
  const failedStep = summary?.steps?.some((step) => step.status === 'failed');
  return summary?.status === 'passed' && completed && !failedStep ? '✅' : '❌';
}

module.exports = { summaryReportIcon };
