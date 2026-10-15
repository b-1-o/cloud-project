"use client";

import { useId, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";

type CollectionFolderProps = {
  label: string;
  description: string;
  count: number;
  color: string;
  active?: boolean;
  onClick: () => void;
};

export default function CollectionFolder({
  label,
  description,
  count,
  color,
  active = false,
  onClick,
}: CollectionFolderProps) {
  const baseId = useId().replace(/:/g, "");
  const backGradient = baseId + "-folder-back";
  const frontGradient = baseId + "-folder-front";
  const style = { "--folder-accent": color } as CSSProperties;

  return (
    <button
      type="button"
      className={["collection-folder", active ? "is-active" : ""].filter(Boolean).join(" ")}
      style={style}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="collection-folder-art" aria-hidden="true">
        <svg viewBox="0 0 164 108" fill="none">
          <defs>
            <linearGradient id={backGradient} x1="82" y1="16" x2="82" y2="98" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--folder-accent)" stopOpacity=".72" />
              <stop offset="1" stopColor="var(--folder-accent)" stopOpacity=".28" />
            </linearGradient>
            <linearGradient id={frontGradient} x1="82" y1="35" x2="82" y2="98" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--folder-accent)" stopOpacity=".58" />
              <stop offset="1" stopColor="var(--folder-accent)" stopOpacity=".24" />
            </linearGradient>
            <linearGradient id={baseId + "-folder-glint"} x1="24" y1="38" x2="131" y2="93" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffffff" stopOpacity=".54" />
              <stop offset=".55" stopColor="#ffffff" stopOpacity=".08" />
              <stop offset="1" stopColor="#ffffff" stopOpacity=".02" />
            </linearGradient>
          </defs>
          <ellipse cx="83" cy="98" rx="55" ry="5" fill="var(--folder-accent)" fillOpacity=".14" />
          <g className="collection-folder-sheets">
            <path className="folder-sheet folder-sheet--back" d="M39 24H76L85 33V78Q85 82 81 82H39Q35 82 35 78V28Q35 24 39 24Z" fill="#f7f8fc" fillOpacity=".78" stroke="#ffffff" strokeOpacity=".8" />
            <path className="folder-sheet folder-sheet--middle" d="M49 29H86L95 38V82Q95 86 91 86H49Q45 86 45 82V33Q45 29 49 29Z" fill="#eef0f7" fillOpacity=".92" stroke="#ffffff" strokeOpacity=".85" />
            <path className="folder-sheet folder-sheet--front" d="M59 34H96L105 43V83Q105 87 101 87H59Q55 87 55 83V38Q55 34 59 34Z" fill="#ffffff" fillOpacity=".97" stroke="#ffffff" strokeOpacity=".95" />
            <path d="M65 47H91M65 55H96M65 63H88M65 71H94" stroke="var(--folder-accent)" strokeOpacity=".42" strokeWidth="2.4" strokeLinecap="round" />
          </g>
          <path d="M14 28Q14 20 22 20H52Q57 20 61 24L67 30H140Q150 30 150 40V84Q150 94 140 94H24Q14 94 14 84V28Z" fill={"url(#" + backGradient + ")"} stroke="var(--folder-accent)" strokeOpacity=".45" />
          <path d="M13 45Q13 36 22 36H140Q151 36 149 47L144 85Q143 94 134 94H24Q14 94 13 84V45Z" fill={"url(#" + frontGradient + ")"} stroke="#ffffff" strokeOpacity=".5" />
          <path className="collection-folder-glint" d="M22 40H134Q143 40 142 48L139 59" stroke={"url(#" + baseId + "-folder-glint)"} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M21 87Q23 90 29 90H131" stroke="#ffffff" strokeOpacity=".2" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="collection-folder-copy">
        <span className="collection-folder-title">{label}</span>
        <span className="collection-folder-description">{description}</span>
      </span>
      <span className="collection-folder-count">{String(count).padStart(2, "0")} <small>{count === 1 ? "item" : "items"}</small></span>
      <span className="collection-folder-arrow"><ArrowUpRight size={15} strokeWidth={1.8} /></span>
    </button>
  );
}
