import { StatusPulse } from '../../components/shared/StatusPulse';
import { getMockCronJobs } from '../../lib/mock-data';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function CronTab() {
  const jobs = getMockCronJobs();
  const enabledCount = jobs.filter((j) => j.enabled).length;

  return (
    <div className="p-5 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-slate-200">
          <i className="fa-solid fa-calendar-days text-indigo-500 mr-2" />Scheduled Jobs
        </div>
        <span className="text-[11px] text-slate-500">{jobs.length} jobs · {enabledCount} enabled</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {jobs.map((job) => {
          const isRunning = job.state === 'running';
          const isDisabled = !job.enabled;
          const isFailed = job.state === 'failed';

          return (
            <div
              key={job.id}
              className={`bg-[#161822] border rounded-lg p-3.5 ${
                isRunning ? 'border-green-500/20' : 'border-[#2a2d3a]'
              } ${isDisabled ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2 mb-2">
                {isRunning ? (
                  <StatusPulse status="online" size={10} />
                ) : isFailed ? (
                  <i className="fa-solid fa-circle-xmark text-red-500 text-[10px]" />
                ) : isDisabled ? (
                  <i className="fa-solid fa-circle-pause text-slate-600 text-[10px]" />
                ) : (
                  <i className="fa-regular fa-clock text-indigo-500 text-[10px]" />
                )}
                <span className="text-[13px] font-medium text-slate-200 flex-1">{job.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  isRunning ? 'text-green-500 bg-green-500/10' :
                  isFailed ? 'text-red-400 bg-red-500/10' :
                  isDisabled ? 'text-slate-500 bg-slate-500/10' :
                  'text-indigo-400 bg-indigo-500/10'
                }`}>
                  {isDisabled ? 'disabled' : job.state}
                </span>
              </div>

              {!isDisabled && (
                <div className="text-[11px] text-slate-400 mb-2 font-mono bg-[#0d1117] p-1.5 px-2 rounded">
                  <i className="fa-solid fa-quote-left text-[8px] text-slate-600 mr-1" />
                  {job.prompt}
                </div>
              )}

              <div className="flex gap-4 text-[11px] text-slate-500">
                <span><i className="fa-solid fa-repeat mr-1" />{job.schedule.display ?? job.schedule.expression}</span>
                {job.model && <span><i className="fa-solid fa-robot mr-1" />{job.model}</span>}
                {job.deliver && <span><i className="fa-solid fa-paper-plane mr-1" />{job.deliver}</span>}
                {job.lastRunAt && <span><i className="fa-solid fa-clock-rotate-left mr-1" />Last: {timeAgo(job.lastRunAt)}</span>}
                {job.nextRunAt && <span><i className="fa-solid fa-forward mr-1" />Next: {job.nextRunAt}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
