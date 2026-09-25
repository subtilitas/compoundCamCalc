# User guide

The Compound Cam Calculator designs the cams of a twin-cam compound bow from
the draw force curve the bow should have. This guide covers the force curve
editor, which defines that curve.

## Screen layout

- **Force curve** panel: the chart, the editing toolbar, the stats line and
  the point table.
- **Settings** panel: bow geometry, draw force parameters and display units.

On screens 960 px wide or wider the panels sit side by side; on narrower
screens the settings follow below the chart. The point table is open on wide
screens and closed on narrow screens; select **Point table** to open or close
it.

## The chart

The chart shows draw force against draw length. The x axis runs from the
draw length at brace to full draw in the AMO (Archery Manufacturers
Organization) convention: nock to grip pivot point plus 1.75 in. The y axis
runs from 0 to about 1.15 times the highest point. Dashed vertical lines mark
brace and full draw.

The curve passes through every control point. Between two points the curve
never rises above or drops below those two points, so each peak and each dip
of the curve sits at a control point. The curve is smooth up to its second
derivative (C2), which the cam solver needs.

Point 1 is the brace point at 0 N. It is fixed and not editable. The last
point sits at full draw: its draw length follows the draw length setting and
only its force can change.

## Editing with a mouse

- Drag a point to move it. A label next to the point shows its position, for
  example "24.0 in, 251 N".
- Double-click empty chart space to add a point at that position.
- Right-click a point to remove it.
- **Add point** adds a point in the middle of the widest gap between two
  points, on the curve.
- **Delete point** removes the selected point.

## Editing on a touch screen

- Drag a point with one finger to move it. The page does not scroll while a
  finger is on the chart.
- Tap a point to select it, then tap **Delete point** to remove it.
- Tap **Add point** to add a point in the widest gap.

A long press on a point does not remove it.

## Editing with the keyboard

- Tab moves between the points of the chart. The focused point is selected.
- Arrow keys move the focused point: left and right by 0.1 in (2.5 mm or
  0.25 cm in metric units), up and down by 1 N (0.2 lbf). With Shift held
  the steps are 10 times larger.
- Delete or Backspace removes the focused point.
- Insert or + adds a point after the focused point, halfway to the next one.
- Ctrl+Z (Cmd+Z on macOS) undoes, Ctrl+Shift+Z (Cmd+Shift+Z) and Ctrl+Y
  redo. In text fields these keys act on the text.

## Point table

Each row lists the draw length (AMO) and the force of one point. Type a new
value and press Enter or leave the field to apply it; press Escape to
restore the old value. A decimal comma works as well as a decimal point, and
a unit suffix overrides the display unit, for example "740 mm" or "60 lbf".

A value that is not a number or lies outside the allowed range is not
applied; a message next to the field names the allowed range. The brace
point and the draw length of the full-draw point are marked as fixed.

## Editing limits

- Points keep a distance of at least 0.1 in (2.54 mm) from their neighbours.
- Forces stay between 1 N and 5000 N, except the brace point at 0 N.
- A curve has at least 3 and at most 50 points.

A drag stops at these limits. The toolbar and the keyboard report a refused
edit in the status line under the stats.

## Settings

- **Axle-to-axle length (ATA)**, **Brace height**, **Draw length (AMO)**:
  bow geometry. The draw length must exceed the brace height by more than
  6.75 in (1.75 in AMO offset plus 5 in of power stroke). A change of brace
  height or draw length moves the brace point and the full-draw point; the
  other points keep their relative position in the power stroke.
- **Peak draw force** and **Let-off**: sliders apply while moving; the text
  fields apply on Enter or when leaving the field.
- **Rise to peak** (share of the power stroke) and **Valley width**: shape
  of the generated curve.
- **Units**: draw length in in, mm or cm; force in N or lbf; energy in J or
  ft·lbf. The model works in SI units (metre, newton, joule); the units only
  change the display and the default unit of typed values.

Each text field has a − and a + button and responds to the up and down arrow
keys with the step shown under the field. A value outside the range shows a
message and is not applied.

## Parametric and custom curves

The badge next to the chart title shows the curve mode.

- **Parametric**: the points follow the peak, let-off, rise and valley
  settings. Seven points describe brace, a ramp point, peak start, peak end,
  a let-off transition point, valley start and full draw.
- **Custom**: any edit of a point switches to custom mode. The peak slider
  then scales all forces, and the let-off slider changes the points after
  the peak so the holding weight matches. Rise and valley width apply when
  the curve is regenerated.

**Regenerate from parameters** and **Reset curve** replace the points with
the parametric curve of the current settings. The peak and let-off settings
follow the custom curve, so a regenerated curve keeps them.

## Undo and redo

**Undo** and **Redo** step through the last 100 changes, including settings
and unit changes. One drag of a point or of a slider counts as one change.

## Saving

The project is saved in the browser (localStorage) 300 ms after each change
and restored when the page opens again. Saved data that cannot be read, for
example from a newer version of the app, is replaced by the default project
and a notice explains why. A browser that blocks storage shows a notice
that changes are lost when the page closes.

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
with a click, a tap, or Enter and Space on the keyboard, and close with
Escape or a click outside.
