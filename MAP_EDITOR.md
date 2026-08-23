# Map editor

Editor state is intentionally separate from source geometry. Region selection, palettes, opacity, line weight, layer visibility, label fields, filters, annotations, and viewport belong to a map project.

The current slice includes:

- viewer/editor mode switch;
- layer and source panels;
- region style palette, opacity, and line weight controls;
- label visibility and field selection;
- deterministic command actions;
- undo/redo for style, layer, view, and filter changes;
- saved-view shell and auto-save status.

Annotation storage and the command protocol are ready to expand into movable text, markers, arrows, shapes, legends, and callouts.
