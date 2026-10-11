#!/usr/bin/env bash
# Starts the cmdAbl agent team. Each agent is a peer Claude session with the session id from its
# .claude/agents/*.md ("Session id: <uuid>"); an existing session is resumed, a new one gets that id.
# - core, modules, bridge and reviewer open as splits in one tmux window "cmdabl-agents" (tiled)
# - ui is on demand: it only starts when you name it
# - the architect replaces this script in the current pane (your main window)
# Usage: scripts/agents.sh                   start the default team (architect in this pane)
#        scripts/agents.sh ui                add the on-demand UI agent to the agents window
#        scripts/agents.sh core reviewer     start only these peers (also: modules, bridge, ui)
#        scripts/agents.sh architect         start only the architect
#        DRY_RUN=1 scripts/agents.sh         print the commands instead of running them
set -euo pipefail
cd "$(dirname "$0")/.."
WINDOW=cmdabl-agents
MAX_PANES=5

# name  agent-file  model
PEERS=(
	"cmdabl-core core sonnet"
	"cmdabl-modules modules sonnet"
	"cmdabl-bridge bridge sonnet"
	"cmdabl-reviewer reviewer opus"
)
# Started only when named on the command line.
ON_DEMAND=(
	"cmdabl-ui ui sonnet"
)
ARCHITECT="cmdabl-architect architect opus"

[ -n "${DRY_RUN:-}" ] || [ -n "${TMUX:-}" ] || { echo "run this inside tmux"; exit 1; }

session_id() { grep -oE 'Session id: `[0-9a-f-]+`' ".claude/agents/$1.md" | grep -oE '[0-9a-f-]{36}'; }
session_exists() { ls ~/.claude/projects/*/"$1".jsonl >/dev/null 2>&1; }
named() { [[ " ${ARGS[*]:-} " == *" ${1#cmdabl-} "* ]]; }
# Default-team members run when no names are given; on-demand agents only when named.
selected() { [ ${#ARGS[@]} -eq 0 ] || named "$1"; }

# claude_cmd <name> <agent> <model>: resume the agent's session, or start it under its id.
claude_cmd() {
	local id
	id=$(session_id "$2")
	if session_exists "$id"; then
		echo "claude --resume $id --agent $2 --model $3 --permission-mode auto"
	else
		echo "claude --session-id $id --agent $2 -n $1 --model $3 --permission-mode auto"
	fi
}

start_peer() {
	local name=$1 agent=$2 model=$3 cmd id panes
	id=$(session_id "$agent")
	if pgrep -f "claude.*$id" >/dev/null; then echo "$name is already running"; return; fi
	cmd=$(claude_cmd "$name" "$agent" "$model")
	if [ -n "${DRY_RUN:-}" ]; then echo "[$WINDOW] $cmd"; return; fi
	if ! tmux list-windows -F '#W' | grep -qx "$WINDOW"; then
		tmux new-window -d -n "$WINDOW" -c "$PWD" "$cmd"
	else
		panes=$(tmux list-panes -t "$WINDOW" | wc -l | tr -d ' ')
		if [ "$panes" -ge "$MAX_PANES" ]; then echo "$WINDOW already has $MAX_PANES panes, not starting $name"; return; fi
		tmux split-window -d -t "$WINDOW" -c "$PWD" "$cmd"
	fi
	tmux select-layout -t "$WINDOW" tiled >/dev/null
	echo "started $name ($model)"
}

ARGS=("$@")

for entry in "${PEERS[@]}"; do
	read -r name agent model <<<"$entry"
	selected "$name" && start_peer "$name" "$agent" "$model"
done
for entry in "${ON_DEMAND[@]}"; do
	read -r name agent model <<<"$entry"
	named "$name" && start_peer "$name" "$agent" "$model"
done

read -r name agent model <<<"$ARCHITECT"
selected "$name" || exit 0
id=$(session_id "$agent")
if pgrep -f "claude.*$id" >/dev/null; then
	echo "$name is already running ($id)"
	exit 0
fi
cmd=$(claude_cmd "$name" "$agent" "$model")
if [ -n "${DRY_RUN:-}" ]; then echo "[this pane] $cmd"; exit 0; fi
echo "starting $name in this pane ($model)"
exec $cmd
