import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";

export type AgentKind = "claude" | "codex";
export type MemberBeeSize = "sm" | "md" | "lg";

export interface MemberBeeProps {
  name: string;
  agent?: AgentKind;
  detail?: string;
  size?: MemberBeeSize;
  showName?: boolean;
  className?: string;
}

const faceScale: Record<MemberBeeSize, number> = { sm: 1, md: 2, lg: 4 };
const agentLabel: Record<AgentKind, string> = { claude: "Claude", codex: "Codex" };

export function MemberBee({ name, agent, detail, size = "md", showName = true, className }: MemberBeeProps) {
  const caption = [agent ? agentLabel[agent] : null, detail].filter(Boolean).join(" · ");

  return (
    <span className={cx("hm-member", agent && `hm-member-${agent}`, `hm-member-${size}`, className)}>
      <span className="hm-member-tile">
        <Sprite name="bee-face" scale={faceScale[size]} title={showName ? undefined : name} />
        {agent && size !== "sm" && (
          <span className="hm-member-badge">
            <Sprite name="icon-terminal" scale={1} title={agentLabel[agent]} />
          </span>
        )}
      </span>
      {showName && (
        <span className="hm-member-text">
          <span className="hm-member-name">{name}</span>
          {caption && size !== "sm" && <span className="hm-member-agent">{caption}</span>}
        </span>
      )}
    </span>
  );
}
