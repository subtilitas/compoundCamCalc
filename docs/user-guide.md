# User guide

The Compound Cam Calculator designs the cams of a twin-cam compound bow from
the draw force curve the bow should have. This guide covers the force curve
editor, which defines that curve, the settings of the bow and the cam, the
results, the draw position, the cam view, the string plan and the loads.

## Screen layout

- **Force curve** panel: the chart, the editing toolbar, the stats line and
  the point table.
- **Results** panel: the solve status, the values of the cam and the
  problems with their suggestions.
- **Draw position** bar: the position along the draw that the cam, the
  string plan, the loads and the force chart show.
- **Cam** panel: a drawing of the top cam at the draw position.
- **String plan** panel: the whole bow from the side, with the cord lengths.
- **Loads** panel: string tension, cable tension and limb tip load against
  the draw.
- **Export** panel: cut files of the cam plates, drawings and the force
  table.
- **Settings** panel: bow geometry, draw force, limbs, string track, cords,
  cam body and display units.

On screens 960 px wide or wider the settings sit to the right of the other
panels; on narrower screens the panels follow each other in the order above. The point table is open on wide
screens and closed on narrow screens; select **Point table** to open or close
it.

## The chart

The chart shows draw force against draw length. The x axis runs from the
draw length at brace to full draw in the AMO (Archery Manufacturers
Organization) convention: nock to grip pivot point plus 1.75 in. The y axis
runs from 0 to about 1.15 times the highest point. Dashed vertical lines mark
brace and full draw. The selected point is drawn above its neighbours, so it
stays visible where points lie close together.

The curve passes through every control point. Between two points the curve
never rises above or drops below those two points, so each peak and each dip
of the curve sits at a control point. The curve is smooth up to its second
derivative (C2), which the cam solver needs.

Point 1 is the brace point at 0 N. It is fixed and not editable. The last
point sits at full draw: its draw length follows the draw length setting and
only its force can change.

## Editing with a mouse

- Drag a point to move it. A label above the point shows its number and
  position, for example "Point 3: 24.0 in, 251 N". The y axis keeps its
  scale during a drag, so a point stops at the top of the chart; the axis
  adapts when the drag ends.
- Double-click empty chart space to add a point at that position.
- Right-click a point to remove it.
- **Add point** adds a point in the middle of the widest gap between two
  points, on the curve.
- **Delete point** removes the selected point.

## Editing on a touch screen

- Drag a point with one finger to move it. The page does not scroll while a
  finger is on the chart. The position label sits 48 px above the point, clear
  of the finger.
- Tap a point to select it, then tap **Delete point** to remove it.
- Tap **Add point** to add a point in the widest gap.

A long press on a point does not remove it.

## Editing with the keyboard

- Tab moves between the points of the chart. The focused point is selected.
- Arrow keys move the focused point: left and right by 0.1 in (2.5 mm or
  0.25 cm in metric units), up and down by 1 N (0.2 lbf). With Shift held
  the steps are 10 times larger. The status line reports the new position,
  for example "Point 3: 14.5 in, 268 N", or the limit that stops the move.
- Delete or Backspace removes the focused point.
- Insert or + adds a point after the focused point, halfway to the next one;
  on the full-draw point it adds one halfway to the previous point.
- Ctrl+Z (Cmd+Z on macOS) undoes, Ctrl+Shift+Z (Cmd+Shift+Z) and Ctrl+Y
  redo. In text fields these keys act on the text.

## Point table

Each row lists the draw length (AMO) and the force of one point. A field
with focus selects its point, so **Delete point** removes the point of the
field being edited. Type a new value and press Enter or leave the field to
apply it; press Escape to restore the old value. A decimal comma works as
well as a decimal point, and a unit suffix overrides the display unit, for
example "740 mm" or "60 lbf".

A value that is not a number or lies outside the allowed range is not
applied; a message next to the field names the allowed range, and the
bounds it names are accepted. The field keeps the rejected text until the
point changes in another way, for example by a drag or an undo. The brace
point and the draw length of the full-draw point are marked as fixed.

## Editing limits

- Points keep a distance of at least 0.1 in (2.54 mm) from their neighbours.
- Forces stay between 1 N and 5000 N, except the brace point at 0 N.
- A curve has at least 3 and at most 50 points.

A drag stops at these limits. The toolbar and the keyboard report a refused
edit in the status line under the stats. The status line describes the last
edit; the next change, an undo or a redo clears it. When a toolbar button
disables itself, for example **Undo** at the end of the history, keyboard
focus moves to the next useful button.

## Settings

- **Axle-to-axle length (ATA)**, **Brace height**, **Draw length (AMO)**:
  bow geometry. The draw length must exceed the brace height by more than
  6.75 in (1.75 in AMO offset plus 5 in of power stroke). A change of brace
  height or draw length moves the brace point and the full-draw point; the
  other points keep their relative position in the power stroke. Where that
  brings two points closer than 0.1 in, they move apart to 0.1 in.
- **Peak draw force** and **Let-off**: sliders apply while moving; the text
  fields apply on Enter or when leaving the field.
- **Rise to peak** (share of the power stroke) and **Valley width**: shape
  of the generated curve. For a narrow valley the let-off drop moves closer
  to full draw. The smallest valley width the curve can reach depends on the
  let-off, the rise and the power stroke: on the default bow it is about
  0.49 in at a let-off of 75 %, 0.68 in at 50 % and 1.54 in at 20 %, and at
  a let-off of 5 % or less the valley covers the whole range from the peak
  to full draw. When the curve misses the requested width by more than 1 %,
  a note under the field names the width it reaches.
- **Limb lever length** and **Limb lever angle at brace**: the rigid lever
  from the limb pivot to the axle.
- **Limbs**: the limb input selects how the limb is given. *Stiffness and
  preload*: the stiffness at the axle and the preload travel from unstrung
  to brace; Results show the axle travel to full draw. *Axle travel and
  preload*: the axle travel from brace to full draw sets the stiffness for
  the draw energy of the curve. *Measured table*: 3 to 50 rows of axle
  travel from brace and force at the axle, with Add row and Remove row.
  **Maximum limb rotation from brace** is the limit of the limb-rotation
  check.
- **String track**: an eccentric circle (radius, centre offset from the
  axle, phase) or an ellipse (semi-major and semi-minor axis, centre offset,
  phase), measured on the groove bottom.
- **Cords**: string and cable diameter and the depth of each groove.
- **Cam body**: axle bore diameter, minimum wall between groove bottom and
  bore, post diameter, minimum bend radius of a track, lead-in wrap of the
  cable at brace and residual wrap of the string at full draw.
- **Units**: draw length in in, mm or cm; force in N or lbf; dimensions in
  mm or in; energy in J or ft·lbf; stiffness in N/mm or lbf/in. The model works in SI units (metre, newton, joule); the units only
  change the display and the default unit of typed values.

Each text field has a − and a + button and responds to the up and down arrow
keys with the step shown under the field. A value outside the range shows a
message and is not applied; the bounds shown under the field, rounded to the
field's decimals, are accepted. A message about a rejected value disappears
when the value changes in another way, for example after an undo or a unit
change.

A status line at the top of the settings shows the solve status, for
example "Cam: 2 problems, see Results", and stays in view while the settings
scroll; select it to go to the results.

## Results

Every change of an input solves the cam again. While a point or a slider is
dragged the solver uses a coarse grid (100 samples); when the drag ends it
solves on the full grid (1500 samples). The newest input always wins: an
older solve that finishes late is shown until the newer one arrives.

- The status line says whether the cam meets the target and every check,
  how many problems it has, or that the solver did not converge. A coarse
  result without problems during a drag is a preview: the full check of
  1500 samples runs when the drag ends.
- The values: achieved peak, holding weight, let-off, draw energy, limb
  energy at full draw, axle travel, cam rotation, string and cable length,
  cam maximum dimension and the smallest radius of curvature of each track
  with its limit. When the cable track is fitted to meet the limits, the
  last row gives the largest force difference from the target and the
  tolerance (3 % of the peak, at least 2 N).
- **Problems** lists each problem with numbers and units and a suggestion
  that names the input to change. Draw ranges of problems are shaded on the
  chart.

The chart shows the achieved force curve of the cam as a dashed line over
the target. When the latest input fails a check, the dashed line is labelled
"Achieved, latest attempt", the values belong to that attempt, and the cam
view keeps the last cam that met every check, dimmed and labelled. When the
latest attempt has no achieved curve, the chart shows the curve of the last
valid cam, dimmed and labelled "Achieved, last valid cam". When a solve
takes longer than 250 ms, the values turn grey and italic, the cam and the
curve dim, and a caption says that they belong to the previous inputs. When the
solver stops with an error, the values are empty and the cam view and the
chart keep the last cam that met every check, dimmed and labelled.

## Draw position

The draw position bar appears once a cam is built. While the cam, the
string plan or the loads are in view, the bar stays at the top of the
window, and a focused control scrolls clear of it. In a window less than
500 px high the bar scrolls with the page.

- The slider runs from brace to full draw in steps of 0.1 in (2.5 mm or
  0.25 cm in metric units). The last step ends at full draw.
- **−** and **+** move one step. **Brace**, **Peak force** and **Full draw**
  jump to those positions.
- With the keyboard, select the slider (Tab). The arrow keys move one step,
  Home jumps to brace and End to full draw.
- The readout gives the draw length, the draw force and the cam rotation
  from brace, for example "Draw 24.00 in, draw force 251 N, cam turned
  180.0° from brace".

The draw position is not part of the project. It is not saved, Undo does
not change it, and moving it does not solve the cam again. A new result
keeps the position: at brace or full draw it stays there, and elsewhere it
keeps its draw length within the new draw range. When the solve stopped
before full draw, a position past the last solved point shows that point
and the readout says so.

The force chart marks the draw position with a vertical line and a dot on
the achieved curve.

## Cam view

The drawing shows the top cam in side view, turned to the draw position.
The axle stays fixed and x points towards the archer. It shows the string
track and the cable track as flange outlines, their groove bottoms
(dashed) and pitch lines (thin), the axle bore, the posts and the timing
marks. At the draw position it also shows:

- the contact points of the string and the cable;
- the lever arms, from the axle to each cord at a right angle (dashed);
- the direction of each cord from its contact point.

The line under the drawing gives the rotation and both lever arms with
their ratio, for example "At 24.0 in: cam turned 180.0°; lever arms:
string 63.6 mm, cable 9.1 mm, ratio 7.0 : 1". A legend names each line. A
scale bar gives the length in the dimension unit. The fitted view covers
the cam in every orientation, so the drawing keeps its scale while the cam
turns.

- **+**, **−** and **Fit** zoom in, zoom out (1 to 8 times) and fit the cam
  in view.
- Hold Ctrl (Cmd on a Mac) and turn the wheel to zoom at the pointer. The
  wheel alone scrolls the page.
- Once zoomed in, drag to pan. With the keyboard, select the drawing (Tab)
  and use the arrow keys to pan (Shift for larger steps), plus and minus to
  zoom and 0 to fit.

## String plan

The string plan shows the whole bow from the side. The grip pivot point is
at the origin and the archer is to the right. The top and bottom halves
are mirror images. It shows the riser line through both limb pivots, the
limb levers from pivot to axle, both cams on their pitch lines, the string
and both power cables. Three poses are drawn:

- brace, outlined and dashed;
- full draw, outlined and dotted;
- the draw position, solid.

An arrow at each axle shows the load on the limb tip at the draw position.
Its length is relative to the largest limb tip load over the draw. The line
under the drawing gives its size and its direction: the angle off the
vertical line from the axle towards the grip, and the side it leans to,
archer or target.

Zoom and pan work as in the cam view. **Top cam** zooms to the top cam.

The list under the drawing gives:

- **String, pitch line**: the length of the cord centre line from the
  termination point on the top cam to the one on the bottom cam, at brace;
- **Power cable, pitch line, each of 2**: the length of the cord centre line
  from its termination point on one cam to the centre of the opposite axle;
- the axle-to-axle length at brace and at full draw, the brace height and
  the draw length.

The cord lengths show in both dimension units. They do not include the
wrap around a post, loops, serving or stretch. Add these for the build.

## Loads

The chart shows three forces against the draw length:

- string tension (solid);
- the tension of each power cable (dashed);
- the load on each limb tip (dash-dot). This is the sum of the string, the
  cam's own cable and the cable of the other cam, which is anchored at this
  axle.

A vertical line marks the draw position. Under the chart are the three
values at the draw position with the direction of the limb tip load, the
largest value of each with its draw position, and the limb tip load at
brace. **Load table** lists draw force, the three loads and the cam
rotation at 0 %, 10 % … 100 % of the draw. On a narrow screen the table
scrolls sideways.

When the latest input fails a check, the string plan and the loads show
the last cam that met every check and say so. While a solve takes longer
than 250 ms, they dim and say that they belong to the previous inputs. When
the solve stopped before full draw, the string plan has no full-draw
outline.

## Export

The export files always describe the last cam that met every check: a full
solve (1500 samples) without problems. The status line says whether that
cam belongs to the current inputs or to earlier ones, and gives its design
id. A solve that runs for 250 ms or longer shows "Solving… exports use
design <id> until the new cam meets every check"; a shorter one leaves the
line unchanged. Before any cam meets every check, the buttons do nothing and
the status line says why.

The files are built in idle time 0.8 s after a cam settles, once the panel
is on screen, or at the first click. File names and title blocks carry the
date of the click: a set built the day before is built again.

**All files (ZIP)** saves every file below plus a README with the design
data, the file list and the warnings. Each file also has its own button.

| File | Contents |
|---|---|
| Plates 1 to 5 (DXF) | Cut outline of one plate (layer OUTLINE), the axle bore (BORE) and post holes (POSTS, STOP): closed polylines and circles only |
| Reference drawing (DXF) | Pitch line, groove bottom and flange of both tracks as splines or circles, the middle-flange outline, all holes, timing marks and a title block |
| String plan (DXF) | The whole bow at brace (layer BRACE) and full draw (FULL) with limbs, cams, string and cables, and the cord lengths as text |
| Force table (CSV) | One row per solved draw position, in this column order: draw length (AMO), nock to pivot point, target draw force, achieved draw force, cam rotation from brace, limb rotation, string tension, tension of each cable, load on each limb tip. Each header carries its unit |

File names read `cam-<date>-<design id>-<part>`, for example
`cam-20260925-187dd8-plate1-string-flange.dxf`. The design id changes with
every input except the display units, so files of one design share it.

**Plates.** The plates stack from the string side (+Z towards the viewer):

1. flange, string side;
2. string groove;
3. middle flange, the convex hull of both flanges;
4. cable groove;
5. flange, cable side.

Plate thicknesses are not part of the project yet; a groove plate needs at
least the cord diameter plus clearance. Top and bottom cams use the same
plates: cut each plate twice and turn the bottom set over.

Post holes go only into the flange plates next to the groove of their cord:
the string post into plates 1 and 3, the cable post and the cable stop into
plates 3 and 5. The cable stop peg reaches past the cable flange whenever
the cable groove is shallower than the peg diameter (2.5 mm against 5 mm on
the default preset). Plates 3 and 5 then carry a boss: the outline grows
around the peg by the minimum wall. Any other hole that reaches past a plate
outline is left out. A warning under the buttons names the plate and the
plates that still hold the post, for example "Plate 1 (flange, string
side): the string post reaches past the outline, so this plate has no hole
for it; plate 3 still holds it".

**Units and accuracy.** DXF files are in millimetres at 1:1, with the origin
at the axle centre and the cam at brace, +X towards the archer and +Y up.
Some programs ignore the unit setting of a DXF file: after import, check that
the axle bore has the diameter the panel gives. Every curve lies within
0.01 mm of the model. Kerf compensation is left to the cutting software.

The CSV uses a comma between values and a point as decimal separator, with
the draw and force units of the display. In a spreadsheet with a decimal
comma, open it with the text import and choose comma as the separator.

On a phone, some in-app browsers block downloads; open the page in the
browser app instead.

## Parametric and custom curves

The badge next to the chart title shows the curve mode.

- **Parametric**: the points follow the peak, let-off, rise and valley
  settings. Seven points describe brace, a ramp point, peak start, peak end,
  a let-off transition point, valley start and full draw.
- **Custom**: any edit that moves a point switches to custom mode; an edit
  that changes nothing keeps the mode. The peak slider then scales all
  forces, and the let-off slider changes the points after the peak so the
  holding weight matches. During one slider gesture every value applies to
  the curve from the start of the gesture, so moving the slider back
  restores the curve. A let-off of 0 % keeps the points after the peak just
  below it (by 0.0001 % of the peak), so a later let-off restores their
  shape. Rise and valley width apply when the curve is reset.

**Reset curve** replaces the points with the parametric curve of the current
settings. The peak and let-off settings follow the custom curve within their
ranges (peak 50 N to 900 N, let-off up to 95 %), so a reset curve keeps them.
A custom curve outside these ranges shows a note under the field, for
example "The custom curve peaks at 1200 N, outside this range; Reset curve
uses 900 N".

## Undo and redo

**Undo** and **Redo** step through the last 100 changes, including settings
and unit changes. One drag of a point or of a slider counts as one change;
Undo and Redo wait until the drag ends.

## Saving

The project is saved in the browser (localStorage) 300 ms after each change,
or at once when the page is hidden or closed, and restored when the page
opens again. When saved data cannot be read, for example data from a newer
version of the app, the default project is shown and a notice explains why.
A copy of the unreadable data stays in localStorage under the key
`compoundCamCalc.project.unreadable`; the next change replaces the saved
project. A browser that blocks storage shows a notice that changes are lost
when the page closes.

## Stats

| Stat | Meaning |
|---|---|
| Peak | Highest force of the curve |
| Holding weight | Lowest force between the peak and full draw |
| Let-off | (peak − holding weight) / peak, in % |
| Valley width | Length of the draw range around the holding weight, after the peak, where the force stays at or below the holding weight plus 5 % of the peak |
| Draw energy | Area under the curve from brace to full draw, in J or ft·lbf |
| Power stroke | Distance from brace to full draw: draw length − 1.75 in − brace height |

## Terms

- **ATA** (axle-to-axle length): distance between the two cam axles of the
  braced bow.
- **Brace height**: distance from the grip pivot point to the string of the
  braced bow at rest.
- **Draw length (AMO)**: distance from the nock point to the grip pivot
  point at full draw plus 1.75 in.
- **Let-off**: drop from the peak draw force to the holding weight, as a
  percentage of the peak.
- **Holding weight**: lowest draw force between the peak and full draw, the
  force the archer holds at full draw.
- **Valley**: draw range around the holding weight where the force stays
  below the holding weight plus 5 % of the peak.
- **Power stroke**: distance the string travels from brace to full draw.
- **Draw energy**: energy stored by drawing the bow.

The info buttons next to these terms show the same definitions. They open
with a click, a tap, or Enter and Space on the keyboard, below the button or
above it near the bottom of the window, and close with Escape, a click
outside, or when the page scrolls.
