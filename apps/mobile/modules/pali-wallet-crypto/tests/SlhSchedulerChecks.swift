import Foundation

private final class Events: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [String] = []
  func append(_ value: String) { lock.lock(); values.append(value); lock.unlock() }
  func snapshot() -> [String] { lock.lock(); defer { lock.unlock() }; return values }
}
private func wait(_ semaphore: DispatchSemaphore) {
  precondition(semaphore.wait(timeout: .now() + 5) == .success, "scheduler timed out")
}
@main struct SlhSchedulerChecks {
  static func main() {
    let worker = PaliSlhLeafWorker(parallelism: 2), log = Events()
    let started = [DispatchSemaphore(value: 0), DispatchSemaphore(value: 0)]
    let releases = [DispatchSemaphore(value: 0), DispatchSemaphore(value: 0)]
    let completed = [DispatchSemaphore(value: 0), DispatchSemaphore(value: 0)]
    let writeDone = DispatchSemaphore(value: 0), laterDone = DispatchSemaphore(value: 0)
    precondition(worker.parallelism >= 2 && worker.parallelism <= 6)
    for index in 0..<2 {
      precondition(worker.enqueue(kind: .independent, {
        log.append("start\(index)"); started[index].signal(); wait(releases[index]); return index
      }, complete: { value in log.append("done\(value)"); completed[index].signal() }))
    }
    for ready in started { wait(ready) }
    precondition(worker.enqueue({ log.append("write"); return 0 }, complete: { _ in writeDone.signal() }))
    precondition(worker.enqueue(kind: .independent, { log.append("later"); return 0 }, complete: { _ in laterDone.signal() }))
    releases[0].signal(); wait(completed[0]); precondition(!log.snapshot().contains("write"))
    releases[1].signal(); wait(completed[1]); wait(writeDone); wait(laterDone)
    let result = log.snapshot()
    precondition(result.firstIndex(of: "write")! > result.firstIndex(of: "done1")!)
    precondition(result.firstIndex(of: "later")! > result.firstIndex(of: "write")!)

    let cleanWorker = PaliSlhLeafWorker(parallelism: 2), cleanLog = Events()
    let active = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), cleanup = DispatchSemaphore(value: 0)
    precondition(cleanWorker.enqueue(kind: .independent, { active.signal(); wait(release); cleanLog.append("erased"); return 0 }, complete: { _ in cleanLog.append("context.end") }))
    wait(active)
    cleanWorker.cleanup { cleanLog.append("cleanup"); cleanup.signal() }
    precondition(!cleanWorker.enqueue(kind: .independent, { 0 }, complete: { _ in }))
    release.signal(); wait(cleanup)
    precondition(cleanLog.snapshot() == ["erased", "context.end", "cleanup"])

    let bounded = PaliSlhLeafWorker(parallelism: 2), finish = DispatchSemaphore(value: 0), drain = DispatchSemaphore(value: 0)
    for _ in 0..<8 { precondition(bounded.enqueue(kind: .independent, { wait(finish); return 0 }, complete: { _ in drain.signal() })) }
    precondition(!bounded.enqueue(kind: .independent, { 0 }, complete: { _ in }))
    for _ in 0..<8 { finish.signal() }
    for _ in 0..<8 { wait(drain) }
    print("iOS scheduler FIFO overlap/write barrier, cleanup/context drain and total capacity passed")
  }
}
