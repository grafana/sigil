import './.config/jest-setup';

// @grafana/ui ScrollIndicators uses IntersectionObserver which jsdom does not provide
if (typeof global.IntersectionObserver === 'undefined') {
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
