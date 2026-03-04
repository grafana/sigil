type HeightGetter = (index: number) => number;

export default class Positions {
  bufferLen: number;
  dataLen: number;
  heights: number[];
  lastI: number;
  ys: number[];

  constructor(bufferLen: number) {
    this.ys = [];
    this.heights = [];
    this.bufferLen = bufferLen;
    this.dataLen = -1;
    this.lastI = -1;
  }

  profileData(dataLength: number) {
    if (dataLength !== this.dataLen) {
      this.dataLen = dataLength;
      this.ys.length = dataLength;
      this.heights.length = dataLength;
      if (this.lastI >= dataLength) {
        this.lastI = dataLength - 1;
      }
    }
  }

  calcHeights(max: number, heightGetter: HeightGetter, forcedLastI?: number) {
    if (forcedLastI != null) {
      this.lastI = forcedLastI;
    }
    let _max = max + this.bufferLen;
    if (_max <= this.lastI) {
      return;
    }
    if (_max >= this.heights.length) {
      _max = this.heights.length - 1;
    }
    let i = this.lastI;
    if (this.lastI === -1) {
      i = 0;
      this.ys[0] = 0;
    }
    while (i <= _max) {
      const h = (this.heights[i] = heightGetter(i));
      this.ys[i + 1] = this.ys[i] + h;
      i += 1;
    }
    this.lastI = _max;
  }

  calcYs(yValue: number, heightGetter: HeightGetter) {
    while ((this.ys[this.lastI] == null || yValue > this.ys[this.lastI]) && this.lastI < this.dataLen - 1) {
      this.calcHeights(this.lastI, heightGetter);
    }
  }

  confirmHeight(index: number, heightGetter: HeightGetter) {
    let i = index;
    if (i > this.lastI) {
      this.calcHeights(i, heightGetter);
      return;
    }
    const h = heightGetter(i);
    if (h === this.heights[i]) {
      return;
    }
    const chg = h - this.heights[i];
    this.heights[i] = h;
    while (++i <= this.lastI) {
      this.ys[i] += chg;
    }
    if (this.ys[this.lastI + 1] != null) {
      this.ys[this.lastI + 1] += chg;
    }
  }

  findFloorIndex(yValue: number, heightGetter: HeightGetter): number {
    if (this.dataLen <= 0) {
      return 0;
    }

    this.calcYs(yValue, heightGetter);

    let imin = 0;
    let imax = this.lastI;

    if (imax < 0) {
      return 0;
    }
    if (imax === 0) {
      return 0;
    }

    if (this.ys.length < 2 || yValue < this.ys[1]) {
      return 0;
    }
    if (yValue > this.ys[imax]) {
      return imax;
    }
    while (imin < imax) {
      const i = (imin + 0.5 * (imax - imin)) | 0;
      if (yValue > this.ys[i]) {
        if (yValue <= this.ys[i + 1]) {
          return i;
        }
        imin = i;
      } else if (yValue < this.ys[i]) {
        if (yValue >= this.ys[i - 1]) {
          return i - 1;
        }
        imax = i;
      } else {
        return i;
      }
    }
    throw new Error(`unable to find floor index for y=${yValue}`);
  }

  getRowPosition(index: number, heightGetter: HeightGetter): { height: number; y: number } {
    this.confirmHeight(index, heightGetter);
    return {
      height: this.heights[index],
      y: this.ys[index],
    };
  }

  getEstimatedHeight(): number {
    if (this.lastI < 0) {
      return 0;
    }
    const known = this.ys[this.lastI] + this.heights[this.lastI];
    if (this.lastI >= this.dataLen - 1) {
      return known | 0;
    }
    return ((known / (this.lastI + 1)) * this.heights.length) | 0;
  }
}
