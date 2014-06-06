/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Flash bugs to keep in mind:
 *
 * http://aaronhardy.com/flex/displayobject-quirks-and-tips/
 * http://blog.anselmbradford.com/2009/02/12/flash-movie-clip-transformational-properties-explorer-x-y-width-height-more/
 * http://gskinner.com/blog/archives/2007/08/annoying_as3_bu.html
 * http://blog.dennisrobinson.name/getbounds-getrect-unexpected-results/
 *
 */
// Class: DisplayObject
module Shumway.AVM2.AS.flash.display {
  import notImplemented = Shumway.Debug.notImplemented;
  import isNullOrUndefined = Shumway.isNullOrUndefined;
  import asCoerceString = Shumway.AVM2.Runtime.asCoerceString;
  import throwError = Shumway.AVM2.Runtime.throwError;
  import assert = Shumway.Debug.assert;
  import unexpected = Shumway.Debug.unexpected;

  import Bounds = Shumway.Bounds;
  import geom = flash.geom;
  import events = flash.events;

  export enum Direction {
    Upward     = 1,
    Downward   = 2
  }

  /*
   * Invalid Bits:
   *
   * Invalid bits are used to mark path dependent properties of display objects as stale. To compute these properties we either have to
   * walk the tree all the way the root, or visit all children.
   *
   *       +---+
   *       | A |
   *       +---+
   *       /   \
   *   +---+   +---+
   *   | B |   | C |
   *   +---+   +---+
   *           /   \
   *       +---+   +---+
   *       | D |   | E |
   *       +---+   +---+
   *
   * We use a combination of eager invalid bit propagation and lazy property evaluation. If a node becomes invalid because one of its
   * local properties has changed, we mark all of its valid descendents as invalid. When computing dependent properties, we walk up
   * the tree until we find a valid node and propagate the computation lazily downwards, marking all the nodes along the path as
   * valid.
   *
   * Suppose we mark A as invalid, this causes nodes B, C, D, and E to become invalid. We then compute a path dependent property
   * on E, causing A, and C to become valid. If we mark A as invalid again, A and C become invalid again. We don't need to mark
   * parts of the tree that are already invalid.
   *
   *
   * Dirty Bits:
   *
   * These are used to mark properties as having been changed.
   */
  export enum DisplayObjectFlags {
    None                                      = 0x0000,

    /**
     * Display object is visible.
     */
    Visible                                   = 0x0001,

    /**
     * Display object has invalid line bounds.
     */
    InvalidLineBounds                         = 0x0002,

    /**
     * Display object has invalid fill bounds.
     */
    InvalidFillBounds                         = 0x0004,

    /**
     * Display object has an invalid matrix because one of its local properties: x, y, scaleX, ... has been mutated.
     */
    InvalidMatrix                             = 0x0008,

    /**
     * Display object has an invalid concatenated matrix because its matrix or one of its ancestor's matrices has been mutated.
     */
    InvalidConcatenatedMatrix                 = 0x0010,

    /**
     * Display object has an invalid inverted concatenated matrix because its matrix or one of its ancestor's matrices has been
     * mutated. We don't always need to compute the inverted matrix. This is why we use a sepearete invalid flag for it and don't
     * roll it under the |InvalidConcatenatedMatrix| flag.
     */
    InvalidInvertedConcatenatedMatrix         = 0x0020,

    /**
     * Display object has an invalid concatenated color transform because its color transform or one of its ancestor's color
     * transforms has been mutated.
     */
    InvalidConcatenatedColorTransform         = 0x0040,

    /**
     * The display object's constructor has been executed or any of the derived class constructors have executed. It may be
     * that the derived class doesn't call super, in such cases this flag must be set manually elsewhere.
     */
    Constructed                               = 0x0100,

    /**
     * Display object has been removed by the timeline but it no longer recieves any event.
     */
    Destroyed                                 = 0x0200,

    /**
     * Display object is owned by the timeline, meaning that it is under the control of the timeline and that a reference
     * to this object has not leaked into AS3 code via the DisplayObjectContainer methods |getChildAt|,  |getChildByName|
     * or through the execution of the symbol class constructor.
     */
    OwnedByTimeline                           = 0x0400,

    /**
     * Display object is animated by the timeline. It may no longer be owned by the timeline (|OwnedByTimeline|) but it
     * is still animated by it. If AS3 code mutates any property on the display object, this flag is cleared and further
     * timeline mutations are ignored.
     */
    AnimatedByTimeline                        = 0x0800,

    /**
     * Indicates whether this display object should be cached as a bitmap. The display object may be cached as bitmap even
     * if this flag is not set, depending on whether any filters are applied or if the bitmap is too large or we've run out
     * of memory.
     */
    CacheAsBitmap                             = 0x1000,

    /**
     * Indicates whether this display object's matrix has changed since the last time it was synchronized.
     */
    DirtyMatrix                               = 0x100000,

    /**
     * Indicates whether this display object's children list has changed since the last time it was synchronized.
     */
    DirtyChildren                             = 0x200000,

    /**
     * Indicates whether this display object's graphics has changed since the last time it was synchronized.
     */
    DirtyGraphics                             = 0x400000,

    /**
     * Indicates whether this display object's bitmap data has changed since the last time it was synchronized.
     */
    DirtyBitmapData                           = 0x800000,

    /**
     * Indicates whether this display object's has dirty descendents. If this flag is not set then the subtree does not
     * need to be synchronized.
     */
    DirtyChild                                = 0x1000000,

    /**
     * Indicates whether this display object's color transform has changed since the last time it was synchronized
     */
    DirtyColorTransform                       = 0x2000000,

    /**
     * Indicates whether this display object's other properties have changed. We need to split this up in multiple
     * bits so we don't serialize as much.
     */
    DirtyMiscellaneousProperties              = 0x4000000,

    /**
     * Display object has changed since the last time it was drawn.
     */
    DirtyPaint                                = 0x0080,

    /**
     * All synchronizable properties are dirty.
     */
    Dirty                                     = DirtyMatrix | DirtyChildren | DirtyChild | DirtyGraphics | DirtyBitmapData | DirtyColorTransform | DirtyMiscellaneousProperties
  }

  /**
   * Controls how the visitor walks the display tree.
   */
  export enum VisitorFlags {
    /**
     * None
     */
    None         = 0,

    /**
     * Continue with normal traversal.
     */
    Continue     = 0,

    /**
     * Not used yet, should probably just stop the visitor.
     */
    Stop         = 0x01,

    /**
     * Skip processing current node.
     */
    Skip         = 0x02,

    /**
     * Visit front to back.
     */
    FrontToBack  = 0x08,

    /**
     * Only visit the nodes matching a certain flag set.
     */
    Filter       = 0x10
  }

  /*
   * Note: Private or protected functions are prefixed with "_" and *may* return objects that
   * should not be mutated. This is for performance reasons and it's up to you to make sure
   * such return values are cloned.
   *
   * Private or protected functions usually operate on twips, public functions work with pixels
   * since that's what the AS3 specifies.
   */

  export class DisplayObject extends flash.events.EventDispatcher implements IBitmapDrawable, Shumway.Remoting.IRemotable {

    /**
     * Every displayObject is assigned an unique integer ID.
     */
    static _syncID = 0;

    static getNextSyncID() {
      return this._syncID++
    }

    // Called whenever the class is initialized.
    static classInitializer: any = null;

    // Called whenever an instance of the class is initialized.
    static initializer: any = function (symbol: Shumway.Timeline.DisplaySymbol) {
      var self: DisplayObject = this;

      self._id = flash.display.DisplayObject.getNextSyncID();
      self._displayObjectFlags = DisplayObjectFlags.Visible                            |
                                 DisplayObjectFlags.InvalidLineBounds                  |
                                 DisplayObjectFlags.InvalidFillBounds                  |
                                 DisplayObjectFlags.InvalidMatrix                      |
                                 DisplayObjectFlags.InvalidConcatenatedMatrix          |
                                 DisplayObjectFlags.InvalidInvertedConcatenatedMatrix  |
                                 DisplayObjectFlags.DirtyGraphics                      |
                                 DisplayObjectFlags.DirtyMatrix                        |
                                 DisplayObjectFlags.DirtyColorTransform                |
                                 DisplayObjectFlags.DirtyMiscellaneousProperties;

      self._root = null;
      self._stage = null;
      self._name = null;
      self._parent = null;
      self._mask = null;

      self._z = 0;
      self._scaleX = 1;
      self._scaleY = 1;
      self._scaleZ = 1;
      self._rotation = 0;
      self._rotationX = 0;
      self._rotationY = 0;
      self._rotationZ = 0;

      self._width = 0;
      self._height = 0;
      self._opaqueBackground = null;
      self._scrollRect = null;
      self._filters = [];
      self._blendMode = BlendMode.NORMAL;
      assert (self._blendMode);
      self._scale9Grid = null;
      self._loaderInfo = null;
      self._accessibilityProperties = null;

      self._fillBounds = new Bounds(0, 0, 0, 0);
      self._lineBounds = new Bounds(0, 0, 0, 0);
      self._clipDepth = 0;

      self._concatenatedMatrix = new geom.Matrix();
      self._invertedConcatenatedMatrix = new geom.Matrix();
      self._matrix = new geom.Matrix();
      self._matrix3D = null;
      self._colorTransform = new geom.ColorTransform();
      self._concatenatedColorTransform = new geom.ColorTransform();

      self._depth = 0;
      self._ratio = 0;
      self._index = -1;
      self._maskedObject = null;

      self._mouseOver = false;
      self._mouseDown = false;

      self._symbol = null;
      self._graphics = null;
      self._children = null;

      if (symbol) {
        if (symbol.scale9Grid) {
          // No need to take ownership: scale9Grid is never changed.
          self._scale9Grid = symbol.scale9Grid;
        }
        self._symbol = symbol;
      }
    };

    // List of static symbols to link.
    static classSymbols: string [] = null; // [];

    // List of instance symbols to link.
    static instanceSymbols: string [] = null; // ["hitTestObject", "hitTestPoint"];

    /**
     * Creates a new display object from a symbol and initializes its animated display properties.
     * Calling its constructor is optional at this point, since that can happen in a later frame phase.
     */
    static createAnimatedDisplayObject(state: Shumway.Timeline.AnimationState, callConstructor: boolean = true): DisplayObject {
      var symbol = state.symbol;
      var symbolClass = symbol.symbolClass;
      var instance: DisplayObject;
      if (symbolClass.isSubtypeOf(flash.display.BitmapData)) {
        instance = flash.display.Bitmap.initializeFrom(symbol);
      } else {
        instance = symbolClass.initializeFrom(symbol);
      }
      instance._setFlags(DisplayObjectFlags.AnimatedByTimeline);
      instance._setFlags(DisplayObjectFlags.OwnedByTimeline);
      instance._animate(state);
      if (callConstructor) {
        symbolClass.instanceConstructorNoInitialize.call(instance);
      }
      return instance;
    }

    /**
     * Dispatches a frame event on all instances of DisplayObjects.
     */
    static _broadcastFrameEvent(type: string): void {
      var event: flash.events.Event;
      switch (type) {
        case events.Event.ENTER_FRAME:
        case events.Event.FRAME_CONSTRUCTED:
        case events.Event.EXIT_FRAME:
        case events.Event.RENDER:
          // TODO: Fire RENDER events only for objects on the display list.
          event = events.Event.getBroadcastInstance(type);
      }
      assert (event, "Invalid frame event.");
      events.EventDispatcher.broadcastEventDispatchQueue.dispatchEvent(event);
    }

    constructor () {
      false && super(undefined);
      events.EventDispatcher.instanceConstructorNoInitialize();
      this._setFlags(DisplayObjectFlags.Constructed);
    }

    _setFillAndLineBoundsFromWidthAndHeight(width: number, height: number) {
      this._fillBounds.setElements(0, 0, width, height);
      this._lineBounds.setElements(0, 0, width, height);
      this._removeFlags(DisplayObjectFlags.InvalidLineBounds | DisplayObjectFlags.InvalidFillBounds);
      this._invalidateParentFillAndLineBounds();
    }

    _setFillAndLineBoundsFromSymbol(symbol: Timeline.DisplaySymbol) {
      if (symbol.fillBounds) {
        this._fillBounds.copyFrom(symbol.fillBounds);
      }
      if (symbol.lineBounds) {
        this._lineBounds.copyFrom(symbol.lineBounds);
      }
      this._removeFlags(DisplayObjectFlags.InvalidLineBounds | DisplayObjectFlags.InvalidFillBounds);
      this._invalidateParentFillAndLineBounds();
    }

    _setFlags(flags: DisplayObjectFlags) {
      this._displayObjectFlags |= flags;
    }

    /**
     * Use this to set dirty flags so that we can also propagate the dirty child bit.
     */
    _setDirtyFlags(flags: DisplayObjectFlags) {
      this._displayObjectFlags |= flags;
      this._dirty();
    }

    _toggleFlags(flags: DisplayObjectFlags, on: boolean) {
      if (on) {
        this._displayObjectFlags |= flags;
      } else {
        this._displayObjectFlags &= ~flags;
      }
    }

    _removeFlags(flags: DisplayObjectFlags) {
      this._displayObjectFlags &= ~flags;
    }

    _hasFlags(flags: DisplayObjectFlags): boolean {
      return (this._displayObjectFlags & flags) === flags;
    }

    _hasAnyFlags(flags: DisplayObjectFlags): boolean {
      return !!(this._displayObjectFlags & flags);
    }

    /**
     * Propagates flags up and down the the display list. Flags propagation stops if the flags are
     * already set.
     */
    _propagateFlags(flags: DisplayObjectFlags, direction: Direction) {
      // Multiple flags can be passed here, stop propagation when all the flags are set.
      if (this._hasFlags(flags)) {
        return;
      }
      this._setFlags(flags);

      if (direction & Direction.Upward) {
        var node = this._parent;
        while (node) {
          node._setFlags(flags);
          node = node._parent;
        }
      }

      if (direction & Direction.Downward) {
        if (DisplayObjectContainer.isType(this)) {
          var children = (<DisplayObjectContainer>this)._children;
          for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (!child._hasFlags(flags)) {
              child._propagateFlags(flags, Direction.Downward);
            }
          }
        }
      }
    }

    // AS -> JS Bindings

    _id: number;
    private _displayObjectFlags: number;

    _root: flash.display.DisplayObject;
    _stage: flash.display.Stage;
    _name: string;
    _parent: flash.display.DisplayObjectContainer;
    _mask: flash.display.DisplayObject;

    /**
     * These are always the most up to date properties. The |_matrix| is kept in sync with
     * these values. This is only true when |_matrix3D| is null.
     */
    _scaleX: number;
    _scaleY: number;

    _z: number;
    _scaleZ: number;
    _rotation: number;

    _rotationX: number;
    _rotationY: number;
    _rotationZ: number;

    _mouseX: number;
    _mouseY: number;

    _width: number;
    _height: number;
    _opaqueBackground: ASObject;
    _scrollRect: flash.geom.Rectangle;
    _filters: any [];
    _blendMode: string;
    _scale9Grid: Bounds;
    _loaderInfo: flash.display.LoaderInfo;
    _accessibilityProperties: flash.accessibility.AccessibilityProperties;

    /**
     * Bounding box excluding strokes.
     */
    _fillBounds: Bounds;

    /**
     * Bounding box including strokes.
     */
    _lineBounds: Bounds;

    _clipDepth: number;

    /**
     * The a, b, c, d components of the matrix are only valid if the InvalidMatrix flag
     * is not set. Don't access this directly unless you can be sure that its components
     * are valid.
     */
    _matrix: flash.geom.Matrix;


    _concatenatedMatrix: flash.geom.Matrix;
    _invertedConcatenatedMatrix: flash.geom.Matrix;
    _colorTransform: flash.geom.ColorTransform;
    _concatenatedColorTransform: flash.geom.ColorTransform;
    _matrix3D: flash.geom.Matrix3D;
    _depth: number;
    _ratio: number;

    /**
     * Index of this display object within its container's children
     */
    _index: number;

    _isContainer: boolean;
    _maskedObject: flash.display.DisplayObject;
    _mouseOver: boolean;
    _mouseDown: boolean;

    _symbol: Shumway.Timeline.Symbol;
    _graphics: flash.display.Graphics;

    /**
     * This is only ever used in classes that can have children, like |DisplayObjectContainer| or |SimpleButton|.
     */
    _children: DisplayObject [];

    /**
     * Finds the nearest ancestor with a given set of flags that are either turned on or off.
     */
    private _findNearestAncestor(flags: DisplayObjectFlags, on: boolean): DisplayObject {
      var node = this;
      while (node) {
        if (node._hasFlags(flags) === on) {
          return node;
        }
        node = node._parent;
      }
      return null;
    }

    /**
     * Tests if this display object is an ancestor of the specified display object.
     */
    _isAncestor(child: DisplayObject): boolean {
      var node = child;
      while (node) {
        if (node === this) {
          return true;
        }
        node = node._parent;
      }
      return false;
    }

    /**
     * Clamps the rotation value to the range (-180, 180).
     */
    private static _clampRotation(value): number {
      value %= 360;
      if (value > 180) {
        value -= 360;
      } else if (value < -180) {
        value += 360;
      }
      return value;
    }

    /**
     * Used as a temporary array to avoid allocations.
     */
    private static _path: DisplayObject[] = [];

    /**
     * Return's a list of ancestors excluding the |last|, the return list is reused.
     */
    private static _getAncestors(node: DisplayObject, last: DisplayObject = null) {
      var path = DisplayObject._path;
      path.length = 0;
      while (node && node !== last) {
        path.push(node);
        node = node._parent;
      }
      assert (node === last, "Last ancestor is not an ancestor.");
      return path;
    }

    /**
     * Computes the combined transformation matrixes of this display object and all of its parents. It is not
     * the same as |transform.concatenatedMatrix|, the latter also includes the screen space matrix.
     */
    _getConcatenatedMatrix(): flash.geom.Matrix {
      // Compute the concatenated transforms for this node and all of its ancestors.
      if (this._hasFlags(DisplayObjectFlags.InvalidConcatenatedMatrix)) {
        var ancestor = this._findNearestAncestor(DisplayObjectFlags.InvalidConcatenatedMatrix, false);
        var path = DisplayObject._getAncestors(this, ancestor);
        var m = ancestor ? ancestor._concatenatedMatrix.clone() : new geom.Matrix();
        for (var i = path.length - 1; i >= 0; i--) {
          var ancestor = path[i];
          assert (ancestor._hasFlags(DisplayObjectFlags.InvalidConcatenatedMatrix));
          m.preMultiply(ancestor._getMatrix());
          ancestor._concatenatedMatrix.copyFrom(m);
          ancestor._removeFlags(DisplayObjectFlags.InvalidConcatenatedMatrix);
        }
      }
      return this._concatenatedMatrix;
    }

    _getInvertedConcatenatedMatrix(): flash.geom.Matrix {
      if (this._hasFlags(DisplayObjectFlags.InvalidInvertedConcatenatedMatrix)) {
        this._invertedConcatenatedMatrix.copyFrom(this._getConcatenatedMatrix());
        this._invertedConcatenatedMatrix.invert();
        this._removeFlags(DisplayObjectFlags.InvalidInvertedConcatenatedMatrix);
      }
      return this._invertedConcatenatedMatrix;
    }

    _setMatrix(matrix: flash.geom.Matrix, toTwips: boolean): void {
      if (!toTwips && this._matrix.equals(matrix)) {
        // No need to dirty the matrix if it's equal to the current matrix.
        return;
      }
      var m = this._matrix;
      m.copyFrom(matrix);
      if (toTwips) {
        m.toTwips();
      }
      this._scaleX = m.getScaleX();
      this._scaleY = m.getScaleY();
      this._rotation = DisplayObject._clampRotation(matrix.getRotation() * 180 / Math.PI);
      this._removeFlags(DisplayObjectFlags.InvalidMatrix);
      this._dirtyMatrix();
      this._invalidatePosition();
    }

    /**
     * Returns an updated matrix if the current one is invalid.
     */
    _getMatrix() {
      if (this._hasFlags(DisplayObjectFlags.InvalidMatrix)) {
        this._matrix.updateScaleAndRotation(this._scaleX, this._scaleY, this._rotation);
        this._removeFlags(DisplayObjectFlags.InvalidMatrix);
      }
      return this._matrix;
    }

    /**
     * Computes the combined transformation color matrixes of this display object and all of its ancestors.
     */
    _getConcatenatedColorTransform(): flash.geom.ColorTransform {
      if (!this.stage) {
        return this._colorTransform.clone();
      }
      // Compute the concatenated color transforms for this node and all of its ancestors.
      if (this._hasFlags(DisplayObjectFlags.InvalidConcatenatedColorTransform)) {
        var ancestor = this._findNearestAncestor(DisplayObjectFlags.InvalidConcatenatedColorTransform, false);
        var path = DisplayObject._getAncestors(this, ancestor);
        var i = path.length - 1;
        if (flash.display.Stage.isType(path[i])) {
          i--;
        }
        var m = ancestor && !flash.display.Stage.isType(ancestor) ? ancestor._concatenatedColorTransform.clone()
                                                                  : new geom.ColorTransform();
        while (i >= 0) {
          ancestor = path[i--];
          assert (ancestor._hasFlags(DisplayObjectFlags.InvalidConcatenatedColorTransform));
          m.preMultiply(ancestor._colorTransform);
          m.convertToFixedPoint();
          ancestor._concatenatedColorTransform.copyFrom(m);
          ancestor._removeFlags(DisplayObjectFlags.InvalidConcatenatedColorTransform);
        }
      }
      return this._concatenatedColorTransform;
    }

    _setColorTransform(colorTransform: flash.geom.ColorTransform) {
      this._colorTransform.copyFrom(colorTransform);
      this._colorTransform.convertToFixedPoint();
      this._propagateFlags(DisplayObjectFlags.InvalidConcatenatedColorTransform, Direction.Downward);
      this._dirtyColorTransform();
      this._invalidatePaint();
    }

    /**
     * Invalidates the fill- and lineBounds of this display object along with all of its ancestors.
     */
    _invalidateFillAndLineBounds(): void {
      /* TODO: We should only propagate this bit if the bounds are actually changed. We can do the
       * bounds computation eagerly if the number of children is low. If there are no changes in the
       * bounds we don't need to propagate the bit. */
      this._propagateFlags(DisplayObjectFlags.InvalidLineBounds |
                           DisplayObjectFlags.InvalidFillBounds, Direction.Upward);
    }

    _invalidateParentFillAndLineBounds(): void {
      if (this._parent) {
        this._parent._invalidateFillAndLineBounds();
      }
    }

    /**
     * Computes the bounding box for all of this display object's content, its graphics and all of its children.
     */
    _getContentBounds(includeStrokes: boolean = true): Bounds {
      // Tobias: What about filters?
      var invalidFlag: number;
      var bounds: Bounds;
      if (includeStrokes) {
        invalidFlag = DisplayObjectFlags.InvalidLineBounds;
        bounds = this._lineBounds;
      } else {
        invalidFlag = DisplayObjectFlags.InvalidFillBounds;
        bounds = this._fillBounds;
      }
      if (this._hasFlags(invalidFlag)) {
        var graphics: Graphics = this._getGraphics();
        if (graphics) {
          bounds.copyFrom(graphics._getContentBounds(includeStrokes));
        } else {
          bounds.setEmpty();
        }
        if (DisplayObjectContainer.isType(this)) {
          var container: DisplayObjectContainer = <DisplayObjectContainer>this;
          var children = container._children;
          for (var i = 0; i < children.length; i++) {
            bounds.unionInPlace(children[i]._getTransformedBounds(this, includeStrokes));
          }
        }
        this._removeFlags(invalidFlag);
      }
      return bounds;
    }

    /**
     * Gets the bounds of this display object relative to another coordinate space. The transformation
     * matrix from the local coordinate space to the target coordinate space is computed using:
     *
     *   this.concatenatedMatrix * inverse(target.concatenatedMatrix)
     *
     * If the |targetCoordinateSpace| is |null| then assume the identity coordinate space.
     */
    private _getTransformedBounds(targetCoordinateSpace: DisplayObject,
                                  includeStroke: boolean = true): Bounds
    {
      var bounds = this._getContentBounds(includeStroke).clone();
      if (targetCoordinateSpace === this || bounds.isEmpty()) {
        return bounds;
      }
      var m;
      if (targetCoordinateSpace) {
        m = targetCoordinateSpace._getConcatenatedMatrix().clone();
        m.invert();
        m.preMultiply(this._getConcatenatedMatrix());
      } else {
        m = this._getConcatenatedMatrix();
      }
      m.transformBounds(bounds);
      return bounds;
    }

    /**
     * Marks this object as needing to be repainted.
     */
    _invalidatePaint() {
      this._propagateFlags(DisplayObjectFlags.DirtyPaint, Direction.Upward);
    }

    /**
     * Detaches this object from being animated by the timeline. This happens whenever a display
     * property of this object is changed by user code.
     */
    private _stopTimelineAnimation() {
      this._removeFlags(DisplayObjectFlags.AnimatedByTimeline);
    }

    /**
     * Sets the |DirtyMatrix| flag.
     */
    private _dirtyMatrix() {
      this._setDirtyFlags(DisplayObjectFlags.DirtyMatrix);
    }

    /**
     * Sets the |DirtyColorTransform| flag.
     */
    private _dirtyColorTransform() {
      this._setDirtyFlags(DisplayObjectFlags.DirtyColorTransform);
    }

    /**
     * Marks this object as having its matrix changed.
     */
    private _invalidateMatrix() {
      this._dirtyMatrix();
      this._setFlags(DisplayObjectFlags.InvalidMatrix);
      if (this._parent) {
        this._parent._propagateFlags(DisplayObjectFlags.DirtyChild, Direction.Upward);
      }
    }

    /**
     * Marks this object as having been moved in its parent display object.
     */
    _invalidatePosition() {
      this._propagateFlags(DisplayObjectFlags.InvalidConcatenatedMatrix |
                           DisplayObjectFlags.InvalidInvertedConcatenatedMatrix,
                           Direction.Downward);
      this._invalidateParentFillAndLineBounds();
    }

    _dirty() {
      if (this._parent) {
        this._propagateFlags(DisplayObjectFlags.DirtyChild, Direction.Upward);
      }
    }

    /**
     * Animates this object's display properties.
     */
    _animate(state: Shumway.Timeline.AnimationState): void {
      if (state.symbol) {
        if (state.symbol instanceof Shumway.Timeline.ShapeSymbol) {
          this._setGraphics((<Shumway.Timeline.ShapeSymbol>state.symbol).graphics);
        }
        // TODO: Handle http://wahlers.com.br/claus/blog/hacking-swf-2-placeobject-and-ratio/.
      }
      if (state.matrix) {
        this._setMatrix(state.matrix, false);
      }
      if (state.colorTransform) {
        this._setColorTransform(state.colorTransform);
      }
      this._ratio = state.ratio;
      this._name = state.name;
      this._clipDepth = state.clipDepth;
      this._filters = state.filters;
      if (state.blendMode !== this._blendMode) {
        this._blendMode = state.blendMode;
        this._setDirtyFlags(DisplayObjectFlags.DirtyMiscellaneousProperties);
      }
      if (state.cacheAsBitmap) {
        this._setFlags(flash.display.DisplayObjectFlags.CacheAsBitmap);
      }
      if (state.visible !== this._hasFlags(DisplayObjectFlags.Visible)) {
        this._toggleFlags(DisplayObjectFlags.Visible, state.visible);
        this._setDirtyFlags(DisplayObjectFlags.DirtyMiscellaneousProperties);
      }
      // TODO: state.events
      this._invalidatePaint();
    }

    /**
     * Dispatches an event on this object and all its descendants.
     */
    _propagateEvent(event: flash.events.Event): void {
      this.visit(function (node) {
        node.dispatchEvent(event);
        return VisitorFlags.Continue;
      }, VisitorFlags.None);
    }

    get x(): number {
      return this._matrix.tx * 0.05;
    }

    set x(value: number) {
      value = (value * 20) | 0;
      this._stopTimelineAnimation();
      if (value === this._matrix.tx) {
        return;
      }
      this._matrix.tx = value;
      this._invalidatePosition();
      this._dirtyMatrix();
    }

    get y(): number {
      return this._matrix.ty * 0.05;
    }

    set y(value: number) {
      value = (value * 20) | 0;
      this._stopTimelineAnimation();
      if (value === this._matrix.ty) {
        return;
      }
      this._matrix.ty = value;
      this._invalidatePosition();
      this._dirtyMatrix();
    }

    get scaleX(): number {
      return this._scaleX;
    }

    set scaleX(value: number) {
      value = +value;
      this._stopTimelineAnimation();
      if (value === this._scaleX) {
        return;
      }
      this._scaleX = value;
      this._invalidateMatrix();
      this._invalidatePosition();
    }

    get scaleY(): number {
      return this._scaleY;
    }

    set scaleY(value: number) {
      value = +value;
      this._stopTimelineAnimation();
      if (value === this._scaleY) {
        return;
      }
      this._scaleY = value;
      this._invalidateMatrix();
      this._invalidatePosition();
    }

    get scaleZ(): number {
      return this._scaleZ;
    }

    set scaleZ(value: number) {
      value = +value;
      notImplemented("public DisplayObject::set scaleZ"); return;
    }

    get rotation(): number {
      return this._rotation;
    }

    set rotation(value: number) {
      value = +value;
      this._stopTimelineAnimation();
      value = DisplayObject._clampRotation(value);
      if (value === this._rotation) {
        return;
      }
      this._rotation = value;
      this._invalidateMatrix();
      this._invalidatePosition();
    }

    get rotationX(): number {
      return this._rotationX;
    }

    set rotationX(value: number) {
      value = +value;
      notImplemented("public DisplayObject::set rotationX"); return;
    }

    get rotationY(): number {
      return this._rotationY;
    }

    set rotationY(value: number) {
      value = +value;
      notImplemented("public DisplayObject::set rotationY"); return;
    }

    get rotationZ(): number {
      return this._rotationZ;
    }

    set rotationZ(value: number) {
      value = +value;
      notImplemented("public DisplayObject::set rotationZ"); return;
    }

    /**
     * The width of this display object in its parent coordinate space.
     */
    get width(): number {
      var bounds = this._getTransformedBounds(this._parent, true);
      return bounds.width * 0.05;
    }

    /**
     * Attempts to change the width of this display object by changing its scaleX / scaleY
     * properties. The scaleX property is set to the specified |width| value / baseWidth
     * of the object in its parent cooridnate space with rotation applied.
     */
    set width(value: number) {
      value = (value * 20) | 0;
      this._stopTimelineAnimation();
      if (value < 0) {
        return;
      }
      var bounds = this._getTransformedBounds(this._parent, true);
      var contentBounds = this._getContentBounds(true);
      var angle = this._rotation / 180 * Math.PI;
      var baseWidth = contentBounds.getBaseWidth(angle);
      if (!baseWidth) {
        return;
      }
      var baseHeight = contentBounds.getBaseHeight(angle);
      this._scaleY = bounds.height / baseHeight;
      this._scaleX = value / baseWidth;
      this._invalidateMatrix();
      this._invalidatePosition();
    }

    /**
     * The height of this display object in its parent coordinate space.
     */
    get height(): number {
      var bounds = this._getTransformedBounds(this._parent, true);
      return bounds.height * 0.05;
    }

    /**
     * Attempts to change the height of this display object by changing its scaleY / scaleX
     * properties. The scaleY property is set to the specified |height| value / baseHeight
     * of the object in its parent cooridnate space with rotation applied.
     */
    set height(value: number) {
      value = (value * 20) | 0;
      this._stopTimelineAnimation();
      if (value < 0) {
        return;
      }
      var bounds = this._getTransformedBounds(this._parent, true);
      var contentBounds = this._getContentBounds(true);
      var angle = this._rotation / 180 * Math.PI;
      var baseHeight = contentBounds.getBaseWidth(angle);
      if (!baseHeight) {
        return;
      }
      var baseWidth = contentBounds.getBaseWidth(angle);
      this._scaleY = value / baseHeight;
      this._scaleX = bounds.width / baseWidth;
      
      this._invalidateMatrix();
      this._invalidatePosition();
    }

    get mask(): DisplayObject {
      return this._mask;
    }

    /**
     * Sets the mask for this display object. This does not affect the bounds.
     */
    set mask(value: DisplayObject) {
      this._stopTimelineAnimation();
      if (this._mask === value || value === this) {
        return;
      }

      if (value && value._maskedObject) {
        value._maskedObject.mask = null;
      }
      this._mask = value;
      if (value) {
        value._maskedObject = this;
      }
      this._invalidatePaint();
    }

    get transform(): flash.geom.Transform {
      return new flash.geom.Transform(this);
    }

    set transform(value: flash.geom.Transform) {
      this._stopTimelineAnimation();
      if (value.matrix3D) {
        this._matrix3D = value.matrix3D;
      } else {
        this._setMatrix(value.matrix, true);
      }
      this._setColorTransform(value.colorTransform);
    }

    private destroy(): void {
      this._setFlags(DisplayObjectFlags.Destroyed);
    }

    /**
     * Walks up the tree to find this display object's root. An object is classified
     * as a root if its _root property points to itself. Root objects are the Stage,
     * the main timeline object and a Loader's content.
     */
    get root(): DisplayObject {
      var node = this;
      do {
        if (node._root === node) {
          return node;
        }
        node = node._parent;
      } while (node);
      return null;
    }

    /**
     * Walks up the tree to find this display object's stage, the first object whose
     * |_stage| property points to itself.
     */
    get stage(): flash.display.Stage {
      var node = this;
      do {
        if (node._stage === node) {
          assert(flash.display.Stage.isType(node));
          return <flash.display.Stage>node;
        }
        node = node._parent;
      } while (node);
      return null;
    }

    get name(): string {
      return this._name;
    }

    set name(value: string) {
      this._name = asCoerceString(value);
    }

    get parent(): DisplayObjectContainer {
      return this._parent;
    }

    get visible(): boolean {
      return this._hasFlags(DisplayObjectFlags.Visible);
    }

    get alpha(): number {
      return this._colorTransform.alphaMultiplier;
    }

    set alpha(value: number) {
      this._stopTimelineAnimation();
      value = +value;
      if (value === this._colorTransform.alphaMultiplier) {
        return;
      }
      this._colorTransform.alphaMultiplier = value;
      this._colorTransform.convertToFixedPoint();
      this._propagateFlags(DisplayObjectFlags.InvalidConcatenatedColorTransform, Direction.Downward);
      this._invalidatePaint();
      this._setDirtyFlags(DisplayObjectFlags.DirtyColorTransform);
    }

    get blendMode(): string {
      return this._blendMode;
    }

    set blendMode(value: string) {
      this._stopTimelineAnimation();
      value = asCoerceString(value);
      if (value === this._blendMode) {
        return;
      }
      if (BlendMode.toNumber(value) < 0) {
        throwError("ArgumentError", Errors.InvalidEnumError, "blendMode");
      }
      this._blendMode = value;
      this._invalidatePaint();
      this._setDirtyFlags(DisplayObjectFlags.DirtyMiscellaneousProperties);
    }

    get scale9Grid(): flash.geom.Rectangle {
      return this._scale9Grid ? flash.geom.Rectangle.FromBounds(this._scale9Grid) : null;
    }

    set scale9Grid(innerRectangle: flash.geom.Rectangle) {
      this._stopTimelineAnimation();
      this._scale9Grid = Bounds.FromRectangle(innerRectangle);
      // VERIFY: Can we get away with only invalidating paint? Can mutating this property ever change the bounds?
      this._invalidatePaint();
    }

    get cacheAsBitmap(): boolean {
      return this._filters.length > 0 || this._hasFlags(DisplayObjectFlags.CacheAsBitmap);
    }

    set cacheAsBitmap(value: boolean) {
      this._toggleFlags(DisplayObjectFlags.CacheAsBitmap, !!value);
      // VERIFY: Can we get away with only invalidating paint? Can mutating this property ever change the bounds,
      // maybe because of pixel snapping?
      this._invalidatePaint();
    }

    /*
     * References to the internal |_filters| array and its BitmapFilter objects are never leaked outside of this
     * class. The get/set filters accessors always return deep clones of this array.
     */

    get filters(): flash.filters.BitmapFilter [] {
      return this._filters.map(function (x: flash.filters.BitmapFilter) {
        return x.clone();
      });
    }

    set filters(value: flash.filters.BitmapFilter []) {
      this._invalidatePaint();
      if (isNullOrUndefined(value)) {
        this._filters.length = 0;
      } else {
        this._filters = value.map(function (x: flash.filters.BitmapFilter) {
          assert (flash.filters.BitmapFilter.isType(x));
          return x.clone();
        });
      }
    }

    /**
     * Marks this display object as visible / invisible. This does not affect the bounds.
     */
    set visible(value: boolean) {
      this._stopTimelineAnimation();
      value = !!value;
      if (value === this._hasFlags(DisplayObjectFlags.Visible)) {
        return;
      }
      this._toggleFlags(DisplayObjectFlags.Visible, value);
      this._setDirtyFlags(DisplayObjectFlags.DirtyMiscellaneousProperties);
    }

    get z(): number {
      return this._z;
    }

    set z(value: number) {
      value = +value;
      this._z = value;
      notImplemented("public DisplayObject::set z"); return;
    }

    getBounds(targetCoordinateSpace: DisplayObject): flash.geom.Rectangle {
      targetCoordinateSpace = targetCoordinateSpace || this;
      return geom.Rectangle.FromBounds(this._getTransformedBounds(targetCoordinateSpace, true));
    }

    getRect(targetCoordinateSpace: DisplayObject): flash.geom.Rectangle {
      targetCoordinateSpace = targetCoordinateSpace || this;
      return geom.Rectangle.FromBounds(this._getTransformedBounds(targetCoordinateSpace, false));
    }

    /**
     * Converts a point from the global coordinate space into the local coordinate space.
     */
    globalToLocal(point: flash.geom.Point): flash.geom.Point {
      var m = this._getInvertedConcatenatedMatrix();
      var p = m.transformPointInPlace(point.clone().toTwips());
      return p.toPixels();
    }

    /**
     * Converts a point form the local coordinate sapce into the global coordinate space.
     */
    localToGlobal(point: flash.geom.Point): flash.geom.Point {
      var m = this._getConcatenatedMatrix();
      var p = m.transformPointInPlace(point.clone().toTwips());
      return p.toPixels();
    }

    /**
     * Tree visitor that lets you skip nodes or return early.
     */
    public visit(visitor: (DisplayObject) => VisitorFlags, visitorFlags: VisitorFlags, displayObjectFlags: DisplayObjectFlags = DisplayObjectFlags.None) {
      var stack: DisplayObject [];
      var displayObject: DisplayObject;
      var displayObjectContainer: DisplayObjectContainer;
      var frontToBack = visitorFlags & VisitorFlags.FrontToBack;
      stack = [this];
      while (stack.length > 0) {
        displayObject = stack.pop();
        var flags = VisitorFlags.None;
        if (visitorFlags & VisitorFlags.Filter && !displayObject._hasAnyFlags(displayObjectFlags)) {
          flags = VisitorFlags.Skip;
        } else {
          flags = visitor(displayObject);
        }
        if (flags === VisitorFlags.Continue) {
          var children = displayObject._children;
          if (children) {
            var length = children.length;
            for (var i = 0; i < length; i++) {
              var child = children[frontToBack ? i : length - 1 - i];
              stack.push(child);
            }
          }
        } else if (flags === VisitorFlags.Stop) {
          return;
        }
      }
    }

    /**
     * Returns the loader info for this display object's root.
     */
    get loaderInfo(): flash.display.LoaderInfo {
      var root = this.root;
      if (root) {
        assert(root._loaderInfo, "No LoaderInfo object found on root.");
        return root._loaderInfo;
      }
      return null;
    }

    /**
     * Only these objects can have graphics.
     */
    _canHaveGraphics(): boolean {
      return flash.display.Shape.isType(this) ||
             flash.display.Sprite.isType(this) ||
             flash.display.MorphShape.isType(this);
    }

    /**
     * Gets the graphics object of this object. Only Shapes, Sprites, and MorphShapes can have
     * graphics.
     */
    _getGraphics(): flash.display.Graphics {
      if (this._canHaveGraphics()) {
        return (<any>this)._graphics;
      }
      return null;
    }

    /**
     * Lazily construct a graphics object.
     */
    _ensureGraphics(): flash.display.Graphics {
      release || assert (this._canHaveGraphics());
      if (this._graphics) {
        return this._graphics;
      }
      this._graphics = new flash.display.Graphics();
      this._graphics._setParent(this);
      this._invalidateFillAndLineBounds();
      this._setDirtyFlags(DisplayObjectFlags.DirtyGraphics);
      return this._graphics;
    }

    /**
     * This is only ever called from |_animate|. Thes graphics objects cannot be modified so they don't need a back reference.
     */
    _setGraphics(graphics: flash.display.Graphics) {
      if (this._canHaveGraphics()) {
        this._graphics = graphics;
        this._invalidateFillAndLineBounds();
        this._setDirtyFlags(DisplayObjectFlags.DirtyGraphics);
        return;
      }
      unexpected("Cannot set graphics on this type of display object.");
    }

    /**
     * Checks if the bounding boxes of two display objects overlap, this happens in the global
     * coordinate coordinate space.
     *
     * Two objects overlap even if one or both are not on the stage, as long as their bounds
     * in the global coordinate space overlap.
     */
    hitTestObject(other: DisplayObject): boolean {
      release || assert (other && DisplayObject.isType(other));
      var a = this, b = other;
      var aBounds = a._getContentBounds(false).clone();
      var bBounds = b._getContentBounds(false).clone();
      a._getConcatenatedMatrix().transformBounds(aBounds);
      b._getConcatenatedMatrix().transformBounds(bBounds);
      return aBounds.intersects(bBounds);
    }

    /**
     * The |x| and |y| arguments are in global coordinates. The |shapeFlag| indicates whether
     * the hit test should be on the actual pixels of the object |true| or just its bounding
     * box |false|. Use the |ignoreChildren| to only test the display object's graphics and
     * not its children.
     */
    hitTestPoint(x: number, y: number, shapeFlag: boolean = false,
                 ignoreChildren: boolean = false): boolean
    {
      x = +x;
      y = +y;
      shapeFlag = !!shapeFlag;
      var point = new flash.geom.Point(x, y).toTwips();
      this._getInvertedConcatenatedMatrix().transformPointInPlace(point);
      if (!this._getContentBounds().contains(point.x, point.y)) {
        return false;
      }
      if (!shapeFlag) {
        return true;
      }
      /* TODO: Figure out if we need to test against the graphics path first and exit early instead of
       * going down the children list. Testing the path can be more expensive sometimes, more so than
       * testing the children. */
      if (!ignoreChildren && DisplayObjectContainer.isType(this)) {
        var children = (<DisplayObjectContainer>this)._children;
        for (var i = 0; i < children.length; i++) {
          if (children[i].hitTestPoint(x, y, shapeFlag)) {
            return true;
          }
        }
      }
      var graphics = this._getGraphics();
      if (graphics) {
        // TODO: split this up into internal and external versions.
        // The external one must include strokes, the internal shouldn't do the argument validation.
        return graphics._containsPoint(point.x, point.y, true);
      }
      return false;
    }

    get scrollRect(): flash.geom.Rectangle {
      return this._scrollRect ? this._scrollRect.clone() : null;
    }

    set scrollRect(value: flash.geom.Rectangle) {
      value = value;
      this._scrollRect = value ? value.clone() : null;
      /* TODO: Figure out how to deal with the bounds and hit testing when scroll rects are applied.
       * The Flash implementation appears to be broken. */
      notImplemented("public DisplayObject::set scrollRect");
      return;
    }

    get opaqueBackground(): any {
      return this._opaqueBackground;
    }

    /**
     * Sets the opaque background color. By default this is |null|, which indicates that no opaque color is set.
     * Otherwise this is an unsinged number.
     */
    set opaqueBackground(value: any) {
      assert (value === null || Shumway.isInteger(value));
      this._opaqueBackground = value;
    }

    /**
     * Finds the furthest interactive ancestor (or self) to receive pointer events for this object.
     */
    public findFurthestInteractiveAncestorOrSelf(): InteractiveObject {
      var find = InteractiveObject.isType(this) ? <InteractiveObject>this : this._parent;
      var self = this._parent;
      while (self) {
        if (!self.mouseChildren) {
          find = self;
        }
        self = self._parent;
      }
      return find;
    }

    /**
     * Returns the distance between this object and a given ancestor.
     */
    private _getDistance(ancestor: DisplayObject): number {
      var d = 0;
      var node = this;
      while (node !== ancestor) {
        d++;
        node = node._parent;
      }
      return d;
    }

    /**
     * Finds the nearest common ancestor with a given node.
     */
    findNearestCommonAncestor(node: DisplayObject): DisplayObject {
      if (!node) {
        return null;
      }
      var ancestor = this;
      var d1 = ancestor._getDistance(null);
      var d2 = node._getDistance(null);
      while (d1 > d2) {
        ancestor = ancestor._parent;
        d1--;
      }
      while (d2 > d1) {
        node = node._parent;
        d2--;
      }
      while (ancestor !== node) {
        ancestor = ancestor._parent;
        node = node._parent;
      }
      return ancestor;
    }

    get mouseX(): number {
      return this.globalToLocal(flash.ui.Mouse._currentPosition).x;
    }

    get mouseY(): number {
      return this.globalToLocal(flash.ui.Mouse._currentPosition).y;
    }

    public debugTrace() {
      var self = this;
      var writer = new IndentingWriter();
      this.visit(function (node) {
        var distance = node._getDistance(self);
        var prefix = Shumway.StringUtilities.multiple(" ", distance);
        writer.writeLn(prefix + node._id + ": " + node);
        return VisitorFlags.Continue;
      }, VisitorFlags.None);
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // -- Stuff below we still need to port.                                                                                                      --
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /*
    set blendShader(value: flash.display.Shader) {
      value = value;
      notImplemented("public DisplayObject::set blendShader"); return;
      // this._blendShader = value;
    }

     get accessibilityProperties(): flash.accessibility.AccessibilityProperties {
     return this._accessibilityProperties;
     }

     set accessibilityProperties(value: flash.accessibility.AccessibilityProperties) {
     value = value;
     notImplemented("public DisplayObject::set accessibilityProperties"); return;
     // this._accessibilityProperties = value;
     }
   */
  }
}
