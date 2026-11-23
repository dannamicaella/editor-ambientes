export function createHistory(initial, limit = 40) {
  let current = initial
  const done = []
  const undone = []
  return {
    get current() { return current },
    get canUndo() { return !!done.length },
    get canRedo() { return !!undone.length },
    snapshots() { return [...done, current, ...undone] },
    commit(next) {
      if (next === current) return current
      done.push(current)
      if (done.length > limit) done.shift()
      current = next
      undone.length = 0
      return current
    },
    undo() {
      if (done.length) {
        undone.push(current)
        current = done.pop()
      }
      return current
    },
    redo() {
      if (undone.length) {
        done.push(current)
        current = undone.pop()
      }
      return current
    },
  }
}