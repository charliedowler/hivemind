import type { DigestBlock } from "@hivemind/core";
function SlackText({ text }: { text: string }) {
  const parts = text.split(/(<https:\/\/[^>|]+\|[^>]+>|<@[UW][A-Z0-9]+>)/g);
  let offset = 0;
  const keyed = parts.map((part) => {
    const key = String(offset);
    offset += part.length;
    return { part, key };
  });
  return keyed.map(({ part, key }) => {
    const link = /^<(https:\/\/[^>|]+)\|([^>]+)>$/.exec(part);
    const decode = (s: string) =>
      s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return link ? (
      <a key={key} href={link[1]}>
        {decode(link[2]!)}
      </a>
    ) : (
      <span key={key}>{decode(part).replace(/\*([^*]+)\*/g, "$1")}</span>
    );
  });
}
export function DigestBlocks({ blocks }: { blocks: DigestBlock[] }) {
  return (
    <div className="digest-blocks">
      {blocks.map((block) =>
        block.type === "header" ? (
          <h3 key={block.text.text}>{block.text.text}</h3>
        ) : (
          <p key={block.text.text}>
            <SlackText text={block.text.text} />
          </p>
        ),
      )}
    </div>
  );
}
