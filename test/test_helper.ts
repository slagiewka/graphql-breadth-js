// Module-level event sink used by tests that need to assert ordering of
// planning/execution/lazy-load events. Reset in each test's beforeEach.
export const EventCollector = {
  events: [] as unknown[],
  reset(): void {
    this.events = [];
  },
};
