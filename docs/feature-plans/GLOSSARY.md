# cmdAbl

A command palette for Ableton Live: typed command lines act on the objects of a Live Set, and MIDI
controls can run them. This file is the shared language between the user, the plans and the code.

## Commands

**Command line**:
What the user types or binds: one command with its arguments, or several joined by `;`.
_Avoid_: query, macro

**Target**:
The Live object a command acts on, named by path, name or tag.
_Avoid_: selection, object (when the target is meant)

**Page**:
A dialog window cmdAbl opens: it gets data in and gives one answer back when it closes.
_Avoid_: window, view (a view is a layout inside a page)

## Tags

**Tag**:
A word that says what a track is (`drums`, `fx`), so one command can reach every track that carries it.
_Avoid_: label, group (a group is a Live group track)

**Tag list**:
The read-only overview of the Set's tags, one row per tag with its tracks (`tag -l`).
_Avoid_: board, tag board

**Tag editor**:
The page for changing which tracks carry which tags, renaming and removing tags and creating new ones (`tag -e`).
_Avoid_: board, tag board, edit list

**List view**:
The tag editor's layout in two panes: the tags on the left, and the current tag's tracks with a checkbox each on the right.
_Avoid_: single view

**Grid view**:
The tag editor's layout that shows tracks as rows and tags as columns, with a checkbox in each cell.
_Avoid_: matrix (the matrix is the planned MIDI mapping page), table

**Current tag**:
The tag the list view shows the tracks for.
_Avoid_: active tag, selected tag

**Pending change**:
A change made on a page that is not yet written to the Set; Apply writes all of them at once.
_Avoid_: draft, staged change

**Mark**:
To pick rows in a pick list so the command acts on them; marking writes nothing by itself.
_Avoid_: select, check (a checkbox in the tag editor is a pending change, not a mark). Open (user, 2026-11-11): maybe "pick" here and "mark" for the note's stamps; to discuss again.

**Filter**:
Typing on a page narrows what it shows: either it hides what doesn't match (compact) or it only highlights the matches (highlight).
_Avoid_: search (when the list itself changes)

## Note

**Stamp**:
A timestamped entry at the end of the Set's note (key `s`, command `note stamp`), with the song position when the song is running. During Session playback it is linked to the playing scene (later).
_Avoid_: mark (that is picking rows in a pick list), timestamp, log entry

**Song position**:
Where the song is, in Live's bar.beat.sixteenth (`@12.3.1`).
_Avoid_: song time, playhead time

## MIDI mapping

**Control**:
One knob, fader, encoder or button on a MIDI controller, as cmdAbl sees it (`CC37`, `N36`).
_Avoid_: input, source

**Control type**:
What kind of control it is: encoder (relative), pot or fader (absolute), or button.
_Avoid_: mode

**Operator**:
The rule that turns a control's messages into runs of a command line and the value it hands over (`press`, `hold`, `toggle`).
_Avoid_: trigger mode, behaviour

**Binding**:
A control, an operator and the command line it runs.
_Avoid_: mapping (a mapping is the whole set of bindings), assignment

**Pickup**:
How a value catches up when a control's position doesn't match it, so the sound doesn't jump.
_Avoid_: soft takeover, catch-up

## Morph

**Master**:
The one value from 0 to 1, usually on a fader, that moves every engaged morph group.
_Avoid_: crossfader (Live's crossfader is a mixer part), master morph

**Morph group**:
A named set of Live parameters, each with its own LOW, HIGH and curve, that follows the master while engaged.
_Avoid_: scene (a scene is a Live scene), morph bus, snapshot

**LOW / HIGH**:
A parameter's value at the master's left end and at its right end.
_Avoid_: min/max (those are the parameter's own limits), A/B

**Engage**:
To put a morph group on the master, so it follows; disengaged groups leave their parameters alone.
_Avoid_: activate, enable

**Punch-in**:
Engaging a morph group only while a button is held.
_Avoid_: momentary scene, punch FX
