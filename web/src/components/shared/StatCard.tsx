interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  subColor?: string;
}

export function StatCard({ icon, label, value, sub, subColor }: StatCardProps) {
  return (
    <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
      <div className="flex items-center gap-1.5 mb-1">
        <i className={`${icon} text-[11px] text-slate-500`} />
        <span className="text-[11px] text-slate-500">{label}</span>
      </div>
      <div className="text-[22px] font-bold text-slate-200">{value}</div>
      {sub && (
        <div className={`text-[11px] mt-0.5 ${subColor ?? 'text-slate-400'}`}>{sub}</div>
      )}
    </div>
  );
}
