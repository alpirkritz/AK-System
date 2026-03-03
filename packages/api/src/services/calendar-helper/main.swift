import EventKit
import Foundation

// Output structure for each calendar event
struct CalendarEvent: Codable {
    let id: String
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let calendar: String
    let calendarId: String
    let calSource: String
    let calType: Int
    let location: String?
    let notes: String?
    let url: String?
    let status: String
    let organizer: String?
    let attendeeStatus: String  // "accepted" | "declined" | "tentative" | "needsAction" | "unknown"
}

let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)

let fmt = ISO8601DateFormatter()
fmt.formatOptions = [.withInternetDateTime]
fmt.timeZone = TimeZone.current   // output local offset (+02:00) instead of UTC (Z)

func eventStatus(_ ek: EKEventStatus) -> String {
    switch ek {
    case .none:      return "none"
    case .confirmed: return "confirmed"
    case .tentative: return "tentative"
    case .canceled: return "cancelled"
    @unknown default: return "unknown"
    }
}

func attendeeStatus(_ ev: EKEvent) -> String {
    guard let attendees = ev.attendees, !attendees.isEmpty else {
        // No attendees = personal event owned by current user
        return "accepted"
    }
    guard let me = attendees.first(where: { $0.isCurrentUser }) else {
        return "unknown"
    }
    switch me.participantStatus {
    case .accepted:  return "accepted"
    case .declined:  return "declined"
    case .tentative: return "tentative"
    case .pending:   return "needsAction"
    default:         return "unknown"
    }
}

store.requestFullAccessToEvents { granted, error in
    guard granted else {
        let err = ["error": "calendar_access_denied"]
        let data = try! JSONSerialization.data(withJSONObject: err)
        print(String(data: data, encoding: .utf8)!)
        sema.signal()
        return
    }

    // Parse date range from args: --start <ISO> --end <ISO>
    let args = CommandLine.arguments
    var startDate = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
    var endDate   = Calendar.current.date(byAdding: .day, value: +30, to: Date())!

    for i in 0..<args.count {
        if args[i] == "--start", i + 1 < args.count {
            startDate = fmt.date(from: args[i+1]) ?? startDate
        }
        if args[i] == "--end", i + 1 < args.count {
            endDate = fmt.date(from: args[i+1]) ?? endDate
        }
    }

    let pred   = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
    let events = store.events(matching: pred)

    // Deduplicate: same Exchange event appears once as Exchange, once as local copy
    var seen: [String: CalendarEvent] = [:]

    for ev in events {
        let rawId    = ev.eventIdentifier ?? UUID().uuidString
        // The part after ":" is the canonical event ID shared between Exchange and local copy
        let dedupeKey = rawId.contains(":") ? String(rawId.split(separator: ":").last!) : rawId

        let calSource = ev.calendar.source?.title ?? "unknown"

        let built = CalendarEvent(
            id:         rawId,
            title:      ev.title ?? "(no title)",
            start:      fmt.string(from: ev.startDate),
            end:        fmt.string(from: ev.endDate),
            allDay:     ev.isAllDay,
            calendar:   ev.calendar.title,
            calendarId: ev.calendar.calendarIdentifier,
            calSource:  calSource,
            calType:    ev.calendar.type.rawValue,
            location:   (ev.location?.isEmpty == false) ? ev.location : nil,
            notes:      (ev.notes?.isEmpty == false) ? ev.notes : nil,
            url:        ev.url?.absoluteString,
            status:         eventStatus(ev.status),
            organizer:      ev.organizer?.name,
            attendeeStatus: attendeeStatus(ev)
        )

        // Prefer Exchange-sourced copy over local duplicate
        if let existing = seen[dedupeKey] {
            if existing.calSource != "Exchange" && calSource == "Exchange" {
                seen[dedupeKey] = built
            }
        } else {
            seen[dedupeKey] = built
        }
    }

    let result = Array(seen.values).sorted { $0.start < $1.start }
    let encoder = JSONEncoder()
    encoder.outputFormatting = .prettyPrinted
    let data = try! encoder.encode(result)
    print(String(data: data, encoding: .utf8)!)
    sema.signal()
}

sema.wait()
