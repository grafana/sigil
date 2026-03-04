import * as React from 'react';

import Positions from './Positions';

type WrapperProps = {
  style: React.CSSProperties;
  ref: (elm: HTMLDivElement | null) => void;
  onScroll?: () => void;
};

type ListViewProps = {
  dataLength: number;
  getIndexFromKey: (key: string) => number;
  getKeyFromIndex: (index: number) => string;
  initialDraw?: number;
  itemHeightGetter: (index: number, key: string) => number;
  itemRenderer: (
    itemKey: string,
    style: Record<string, string | number>,
    index: number,
    attributes: Record<string, string>
  ) => React.ReactNode;
  itemsWrapperClassName?: string;
  viewBuffer: number;
  viewBufferMin: number;
  windowScroller?: boolean;
  redraw?: unknown;
};

const DEFAULT_INITIAL_DRAW = 300;

export default class ListView extends React.Component<ListViewProps> {
  yPositions: Positions;
  knownHeights: Map<string, number>;
  startIndexDrawn: number;
  endIndexDrawn: number;
  startIndex: number;
  endIndex: number;
  viewHeight: number;
  scrollTop: number;
  isScrolledOrResized: boolean;
  htmlTopOffset: number;
  windowScrollListenerAdded: boolean;
  htmlElm: HTMLElement;
  wrapperElm?: HTMLElement;
  itemHolderElm?: HTMLElement;

  static defaultProps = {
    initialDraw: DEFAULT_INITIAL_DRAW,
    itemsWrapperClassName: '',
    windowScroller: false,
  };

  constructor(props: ListViewProps) {
    super(props);

    this.yPositions = new Positions(200);
    this.knownHeights = new Map();

    this.startIndexDrawn = 2 ** 20;
    this.endIndexDrawn = -(2 ** 20);
    this.startIndex = 0;
    this.endIndex = 0;
    this.viewHeight = -1;
    this.scrollTop = -1;
    this.isScrolledOrResized = false;

    this.htmlTopOffset = -1;
    this.windowScrollListenerAdded = false;
    this.htmlElm = document.documentElement;
  }

  componentDidMount() {
    if (this.props.windowScroller) {
      if (this.wrapperElm) {
        const { top } = this.wrapperElm.getBoundingClientRect();
        this.htmlTopOffset = top + this.htmlElm.scrollTop;
      }
      window.addEventListener('scroll', this.onScroll);
      this.windowScrollListenerAdded = true;
    }
  }

  componentDidUpdate() {
    if (this.itemHolderElm) {
      this.scanItemHeights();
    }
  }

  componentWillUnmount() {
    if (this.windowScrollListenerAdded) {
      window.removeEventListener('scroll', this.onScroll);
    }
  }

  getViewHeight = () => this.viewHeight;

  getBottomVisibleIndex = (): number => {
    const bottomY = this.scrollTop + this.viewHeight;
    return this.yPositions.findFloorIndex(bottomY, this.getHeight);
  };

  getTopVisibleIndex = (): number => this.yPositions.findFloorIndex(this.scrollTop, this.getHeight);

  getRowPosition = (index: number): { height: number; y: number } =>
    this.yPositions.getRowPosition(index, this.getHeight);

  onScroll = () => {
    if (!this.isScrolledOrResized) {
      this.isScrolledOrResized = true;
      window.requestAnimationFrame(this.positionList);
    }
  };

  isViewChanged() {
    if (!this.wrapperElm) {
      return false;
    }
    const useRoot = this.props.windowScroller;
    const clientHeight = useRoot ? this.htmlElm.clientHeight : this.wrapperElm.clientHeight;
    const scrollTop = useRoot ? this.htmlElm.scrollTop : this.wrapperElm.scrollTop;
    return clientHeight !== this.viewHeight || scrollTop !== this.scrollTop;
  }

  calcViewIndexes() {
    const useRoot = this.props.windowScroller;
    if (!useRoot) {
      if (!this.wrapperElm) {
        this.viewHeight = -1;
        this.startIndex = 0;
        this.endIndex = 0;
        return;
      }
      this.viewHeight = this.wrapperElm.clientHeight;
      this.scrollTop = this.wrapperElm.scrollTop;
    } else {
      this.viewHeight = window.innerHeight - this.htmlTopOffset;
      this.scrollTop = window.scrollY;
    }
    const yStart = this.scrollTop;
    const yEnd = this.scrollTop + this.viewHeight;
    this.startIndex = this.yPositions.findFloorIndex(yStart, this.getHeight);
    this.endIndex = this.yPositions.findFloorIndex(yEnd, this.getHeight);
  }

  positionList = () => {
    this.isScrolledOrResized = false;
    if (!this.wrapperElm) {
      return;
    }
    this.calcViewIndexes();
    const maxStart = this.props.viewBufferMin > this.startIndex ? 0 : this.startIndex - this.props.viewBufferMin;
    const minEnd =
      this.props.viewBufferMin < this.props.dataLength - this.endIndex
        ? this.endIndex + this.props.viewBufferMin
        : this.props.dataLength - 1;
    if (maxStart < this.startIndexDrawn || minEnd > this.endIndexDrawn) {
      this.forceUpdate();
    }
  };

  initWrapper = (elm: HTMLDivElement | null) => {
    this.wrapperElm = elm ?? undefined;
    if (!this.props.windowScroller && elm) {
      this.viewHeight = elm.clientHeight;
    }
  };

  initItemHolder = (elm: HTMLDivElement | null) => {
    this.itemHolderElm = elm ?? undefined;
    this.scanItemHeights();
  };

  scanItemHeights = () => {
    if (!this.itemHolderElm) {
      return;
    }
    let lowDirtyKey: string | null = null;
    let highDirtyKey: string | null = null;
    let isDirty = false;
    const nodes = this.itemHolderElm.childNodes;
    const max = nodes.length;
    for (let i = 0; i < max; i++) {
      const node = nodes[i] as HTMLElement;
      const itemKey = node.getAttribute('data-item-key');
      if (!itemKey) {
        continue;
      }
      const measureSrc: Element = node.firstElementChild || node;
      const observed = measureSrc.clientHeight;
      if (observed <= 0) {
        continue;
      }
      const known = this.knownHeights.get(itemKey);
      if (observed !== known) {
        this.knownHeights.set(itemKey, observed);
        if (!isDirty) {
          isDirty = true;
          lowDirtyKey = itemKey;
          highDirtyKey = itemKey;
        } else {
          highDirtyKey = itemKey;
        }
      }
    }
    if (lowDirtyKey != null && highDirtyKey != null) {
      const imin = this.props.getIndexFromKey(lowDirtyKey);
      const imax = highDirtyKey === lowDirtyKey ? imin : this.props.getIndexFromKey(highDirtyKey);
      this.yPositions.calcHeights(imax, this.getHeight, imin);
      this.forceUpdate();
    }
  };

  getHeight = (i: number) => {
    const key = this.props.getKeyFromIndex(i);
    const known = this.knownHeights.get(key);
    if (known != null && known === known && known > 0) {
      return known;
    }
    return this.props.itemHeightGetter(i, key);
  };

  render() {
    const {
      dataLength,
      getKeyFromIndex,
      initialDraw = DEFAULT_INITIAL_DRAW,
      itemRenderer,
      viewBuffer,
      viewBufferMin,
    } = this.props;
    const heightGetter = this.getHeight;
    const items: React.ReactNode[] = [];
    let start: number;
    let end: number;

    this.yPositions.profileData(dataLength);

    if (!this.wrapperElm) {
      start = 0;
      end = (initialDraw < dataLength ? initialDraw : dataLength) - 1;
    } else {
      if (this.isViewChanged()) {
        this.calcViewIndexes();
      }
      const maxStart = viewBufferMin > this.startIndex ? 0 : this.startIndex - viewBufferMin;
      const minEnd = viewBufferMin < dataLength - this.endIndex ? this.endIndex + viewBufferMin : dataLength - 1;
      if (maxStart < this.startIndexDrawn || minEnd > this.endIndexDrawn) {
        start = viewBuffer > this.startIndex ? 0 : this.startIndex - viewBuffer;
        end = this.endIndex + viewBuffer;
        if (end >= dataLength) {
          end = dataLength - 1;
        }
      } else {
        start = this.startIndexDrawn;
        end = this.endIndexDrawn > dataLength - 1 ? dataLength - 1 : this.endIndexDrawn;
      }
    }

    this.yPositions.calcHeights(end, heightGetter, start || -1);
    this.startIndexDrawn = start;
    this.endIndexDrawn = end;

    items.length = end - start + 1;
    for (let i = start; i <= end; i++) {
      const { y: top, height } = this.yPositions.getRowPosition(i, heightGetter);
      const style: Record<string, string | number> = {
        height,
        top,
        position: 'absolute',
      };
      const itemKey = getKeyFromIndex(i);
      const attrs = { 'data-item-key': itemKey };
      items.push(itemRenderer(itemKey, style, i, attrs));
    }

    const wrapperProps: WrapperProps = {
      style: { position: 'relative' },
      ref: this.initWrapper,
    };
    if (!this.props.windowScroller) {
      wrapperProps.onScroll = this.onScroll;
      wrapperProps.style.height = '100%';
      wrapperProps.style.overflowY = 'auto';
    }
    const scrollerStyle: React.CSSProperties = {
      position: 'relative',
      height: this.yPositions.getEstimatedHeight(),
    };

    return (
      <div {...wrapperProps} data-testid="ListView">
        <div style={scrollerStyle}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              margin: 0,
              padding: 0,
            }}
            className={this.props.itemsWrapperClassName}
            ref={this.initItemHolder}
          >
            {items}
          </div>
        </div>
      </div>
    );
  }
}
