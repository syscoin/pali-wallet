import Darwin
import Foundation

// Numeric self-process evidence for one fixed qualification app. No memory
// contents, caller-selected process, production API or periodic sampler.
final class PaliSlhQualificationResources {
  static let bundleIdentifier = "com.paliwallet.qualification.physical.slh"
  private struct Sample {
    let footprint: UInt64
    let peakFootprint: UInt64
    let peakResident: UInt64
  }
  private struct Active {
    let id: String
    let start: Sample
    let started: TimeInterval
    let initialThermal: Int
    var worstThermal: Int
    var observations: Int
    var observer: NSObjectProtocol?
  }
  private let lock = NSLock()
  private var active: Active?
  private var disposed = false
  private func refuse() -> NSError {
    NSError(domain: "PaliSlhQualificationResources", code: 1)
  }
  private func sample() throws -> Sample {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    // phys_footprint is rev1; ledger_phys_footprint_peak is rev3. Do not read
    // fields a kernel did not return, even when this SDK declares them.
    guard let peakOffset = MemoryLayout<task_vm_info_data_t>.offset(of: \.ledger_phys_footprint_peak),
      result == KERN_SUCCESS,
      Int(count) * MemoryLayout<integer_t>.size >= peakOffset + MemoryLayout<Int64>.size else { throw refuse() }
    guard info.ledger_phys_footprint_peak >= 0 else { throw refuse() }
    let resultSample = Sample(footprint: info.phys_footprint,
      peakFootprint: UInt64(info.ledger_phys_footprint_peak), peakResident: info.resident_size_peak)
    guard resultSample.peakFootprint >= resultSample.footprint,
      [resultSample.footprint, resultSample.peakFootprint, resultSample.peakResident].allSatisfy({ $0 > 0 && $0 <= 9_007_199_254_740_991 })
      else { throw refuse() }
    return resultSample
  }
  func begin() throws -> String {
    guard Bundle.main.bundleIdentifier == Self.bundleIdentifier else { throw refuse() }
    lock.lock(); defer { lock.unlock() }
    guard !disposed, active == nil else { throw refuse() }
    let id = UUID().uuidString, first = try sample(), thermal = ProcessInfo.processInfo.thermalState.rawValue
    active = Active(id: id, start: first, started: ProcessInfo.processInfo.systemUptime,
      initialThermal: thermal, worstThermal: thermal, observations: 1)
    active?.observer = NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification,
      object: nil, queue: nil) { [weak self] _ in self?.observe(id) }
    return id
  }
  private func observe(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    guard var value = active, value.id == id else { return }
    value.worstThermal = max(value.worstThermal, ProcessInfo.processInfo.thermalState.rawValue)
    value.observations += 1
    active = value
  }
  func finish(_ id: String) throws -> [String: Any] {
    guard Bundle.main.bundleIdentifier == Self.bundleIdentifier else { throw refuse() }
    lock.lock()
    guard let value = active, value.id == id, !disposed else { lock.unlock(); throw refuse() }
    active = nil; lock.unlock()
    if let observer = value.observer { NotificationCenter.default.removeObserver(observer) }
    let end = try sample(), thermal = ProcessInfo.processInfo.thermalState.rawValue
    let elapsed = (ProcessInfo.processInfo.systemUptime - value.started) * 1000
    guard elapsed >= 0, elapsed <= 1_800_000, value.observations < 10000,
      end.peakFootprint >= value.start.peakFootprint, end.peakResident >= value.start.peakResident else { throw refuse() }
    return ["version": 1, "scope": "process-lifetime-including-startup",
      "startFootprintBytes": value.start.footprint, "endFootprintBytes": end.footprint,
      "peakFootprintBytes": end.peakFootprint, "peakResidentBytes": end.peakResident,
      "elapsedMs": elapsed, "initialThermalState": value.initialThermal,
      "finalThermalState": thermal, "worstThermalState": max(value.worstThermal, thermal),
      "thermalObservations": value.observations + 1]
  }
  func cancel(_ id: String? = nil, dispose: Bool = false) {
    lock.lock()
    if dispose { disposed = true }
    let value = active
    if id == nil || active?.id == id { active = nil }
    lock.unlock()
    if (id == nil || value?.id == id), let observer = value?.observer { NotificationCenter.default.removeObserver(observer) }
  }
  deinit { cancel(dispose: true) }
}
