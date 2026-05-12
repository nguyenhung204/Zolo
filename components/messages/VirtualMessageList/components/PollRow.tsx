import type { ConversationMember } from "@/lib/api/conversations";
import type { Poll } from "@/lib/api/group";
import { PollUI } from "@/components/conversations/PollUI";

interface PollRowProps {
  poll: Poll;
  style?: React.CSSProperties;
  myRole: ConversationMember["role"] | null;
  allowMemberMessage: boolean;
}

export function PollRow({ poll, style, myRole, allowMemberMessage }: PollRowProps) {
  return (
    <div style={style} data-poll-id={poll.id} className="px-4 py-2 flex justify-center">
      <PollUI
        pollId={poll.id}
        myRole={myRole}
        allowMemberMessage={allowMemberMessage}
        initialData={poll}
      />
    </div>
  );
}
