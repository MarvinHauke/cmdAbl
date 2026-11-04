#!/usr/bin/env bash
# Starts and stops the cmdAbl agent team. Each agent is a peer Claude session defined by
# .claude/agents/<agent>.md: the model comes from its `model:` frontmatter, the resume id from its
# "Session id: `<uuid>`" line.
# - Agents start FRESH by default (a new session, small context): their agent file, CLAUDE.md and
#   docs/feature-plans/STATUS.md are the hand-over. --resume continues the stored session instead;
#   use it only for unfinished work, since a long session reloads its whole history.
# - core, modules, bridge and reviewer open as splits in one tmux window "cmdabl-agents" (tiled)
# - ui and docs are on demand: they only start when you name them
# - the architect replaces this script in the current pane (your main window)
# Usage: scripts/agents.sh                    start the default team, fresh (architect in this pane)
#        scripts/agents.sh ui                 add the on-demand UI agent to the agents window
#        scripts/agents.sh core reviewer      start only these (also: modules, bridge, ui, docs, architect)
#        scripts/agents.sh --resume core      resume core's stored session instead of a fresh one
#        scripts/agents.sh stop ui docs       end these agents (/exit, then close the pane)
#        scripts/agents.sh stop               end every running peer (never the pane you run this in)
#        DRY_RUN=1 scripts/agents.sh ...      print the commands instead of running them
set -euo pipefail
cd "$(dirname "$0")/.."
WINDOW=cmdabl-agents
MAX_PANES=6

# name  agent-file
PEERS=(
    "cmdabl-core core"
    "cmdabl-modules modules"
    "cmdabl-bridge bridge"
    "cmdabl-reviewer reviewer"
)
# Started only when named on the command line.
ON_DEMAND=(
    "cmdabl-ui ui"
    "cmdabl-docs docs"
)
ARCHITECT="cmdabl-architect architect"

[ "${DRY_RUN:-}" != "" ] || [ "${TMUX:-}" != "" ] || {
    echo "run this inside tmux"
    exit 1
}

session_id() { grep -oE 'Session id: `[0-9a-f-]+`' ".claude/agents/$1.md" | grep -oE '[0-9a-f-]{36}'; }
model_of() { sed -n '/^---$/,/^---$/s/^model:[[:space:]]*//p' ".claude/agents/$1.md" | head -1; }
session_exists() { ls ~/.claude/projects/*/"$1".jsonl >/dev/null 2>&1; }
named() { [[ " ${ARGS[*]:-} " == *" ${1#cmdabl-} "* ]]; }
# Default-team members run when no names are given; on-demand agents only when named.
selected() { [ ${#ARGS[@]} -eq 0 ] || named "$1"; }
# Running: a tmux pane titled with the agent's name (Claude Code shows the session name), or a
# process started with `-n <name>` or the stored id.
pane_of() { tmux list-panes -a -F '#{pane_id} #{pane_title}' 2>/dev/null | awk -v n="$1" '$0 ~ (" .*" n "$") {print $1; exit}'; }
running() { [ -n "$(pane_of "$1")" ] || pgrep -f -- "claude.*(-n $1( |\$)|$2)" >/dev/null; }

# claude_cmd <name> <agent>: a fresh session, or (with --resume) the stored one.
claude_cmd() {
    local id model
    id=$(session_id "$2")
    model=$(model_of "$2")
    if [ "$RESUME" = 1 ] && session_exists "$id"; then
        echo "claude --resume $id --agent $2 -n $1 --model $model --permission-mode auto"
    else
        echo "claude --agent $2 -n $1 --model $model --permission-mode auto"
    fi
}

start_peer() {
    local name=$1 agent=$2 cmd panes
    if running "$name" "$(session_id "$agent")"; then
        echo "$name is already running"
        return
    fi
    cmd=$(claude_cmd "$name" "$agent")
    if [ "${DRY_RUN:-}" != "" ]; then
        echo "[$WINDOW] $cmd"
        return
    fi
    if ! tmux list-windows -F '#W' | grep -qx "$WINDOW"; then
        tmux new-window -d -n "$WINDOW" -c "$PWD" "$cmd"
    else
        panes=$(tmux list-panes -t "$WINDOW" | wc -l | tr -d ' ')
        if [ "$panes" -ge "$MAX_PANES" ]; then
            echo "$WINDOW already has $MAX_PANES panes, not starting $name"
            return
        fi
        tmux split-window -d -t "$WINDOW" -c "$PWD" "$cmd"
    fi
    tmux select-layout -t "$WINDOW" tiled >/dev/null
    echo "started $name ($(model_of "$agent"), $([ "$RESUME" = 1 ] && echo resumed || echo fresh))"
}

# stop_agent <name>: send /exit to the pane whose title names the agent, close it if still there.
stop_agent() {
    local name=$1 pane self
    self=${TMUX_PANE:-}
    pane=$(pane_of "$name")
    if [ -z "$pane" ]; then
        echo "$name is not running"
        return
    fi
    if [ "$pane" = "$self" ]; then
        echo "not stopping $name: it runs in this pane"
        return
    fi
    if [ "${DRY_RUN:-}" != "" ]; then
        echo "[stop] $name in pane $pane"
        return
    fi
    tmux send-keys -t "$pane" Escape
    tmux send-keys -t "$pane" "/exit" Enter
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        tmux list-panes -a -F '#{pane_id}' | grep -qx "$pane" || { echo "stopped $name"; return; }
        sleep 0.5
    done
    tmux kill-pane -t "$pane" && echo "stopped $name (pane closed)"
}

RESUME=0
ARGS=()
STOP=0
for a in "$@"; do
    case "$a" in
        --resume) RESUME=1 ;;
        stop) STOP=1 ;;
        *) ARGS+=("$a") ;;
    esac
done

if [ "$STOP" = 1 ]; then
    for entry in "${PEERS[@]}" "${ON_DEMAND[@]}" "$ARCHITECT"; do
        read -r name agent <<<"$entry"
        if [ ${#ARGS[@]} -eq 0 ]; then
            [ "$entry" = "$ARCHITECT" ] && continue   # `stop` alone never stops the architect
            stop_agent "$name"
        elif named "$name"; then
            stop_agent "$name"
        fi
    done
    exit 0
fi

for entry in "${PEERS[@]}"; do
    read -r name agent <<<"$entry"
    selected "$name" && start_peer "$name" "$agent"
done
for entry in "${ON_DEMAND[@]}"; do
    read -r name agent <<<"$entry"
    named "$name" && start_peer "$name" "$agent"
done

read -r name agent <<<"$ARCHITECT"
selected "$name" || exit 0
if running "$name" "$(session_id "$agent")"; then
    echo "$name is already running"
    exit 0
fi
cmd=$(claude_cmd "$name" "$agent")
if [ "${DRY_RUN:-}" != "" ]; then
    echo "[this pane] $cmd"
    exit 0
fi
echo "starting $name in this pane ($(model_of "$agent"), $([ "$RESUME" = 1 ] && echo resumed || echo fresh))"
# shellcheck disable=SC2086 # the command is split into words on purpose (no argument has spaces)
exec $cmd
