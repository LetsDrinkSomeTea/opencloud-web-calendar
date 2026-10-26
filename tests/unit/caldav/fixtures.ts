// Multistatus responses as returned by Radicale 3 (default DAV: namespace, C/CS/ICAL prefixes)

export const PRINCIPAL_RESPONSE = `<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:">
  <response>
    <href>/caldav/</href>
    <propstat>
      <prop>
        <current-user-principal>
          <href>/caldav/alice/</href>
        </current-user-principal>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`

export const UNAUTHENTICATED_PRINCIPAL_RESPONSE = `<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:">
  <response>
    <href>/caldav/</href>
    <propstat>
      <prop>
        <current-user-principal>
          <unauthenticated />
        </current-user-principal>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`

export const CALENDAR_HOME_RESPONSE = `<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/caldav/alice/</href>
    <propstat>
      <prop>
        <C:calendar-home-set>
          <href>/caldav/alice/</href>
        </C:calendar-home-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`

export const CALENDARS_RESPONSE = `<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:ICAL="http://apple.com/ns/ical/">
  <response>
    <href>/caldav/alice/</href>
    <propstat>
      <prop>
        <resourcetype>
          <principal />
          <collection />
        </resourcetype>
        <current-user-privilege-set>
          <privilege><read /></privilege>
          <privilege><write /></privilege>
        </current-user-privilege-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
    <propstat>
      <prop>
        <displayname />
        <C:calendar-description />
        <ICAL:calendar-color />
        <CS:getctag />
      </prop>
      <status>HTTP/1.1 404 Not Found</status>
    </propstat>
  </response>
  <response>
    <href>/caldav/alice/personal/</href>
    <propstat>
      <prop>
        <resourcetype>
          <C:calendar />
          <collection />
        </resourcetype>
        <displayname>Personal</displayname>
        <C:calendar-description>My &amp; your events</C:calendar-description>
        <ICAL:calendar-color>#FF5733FF</ICAL:calendar-color>
        <CS:getctag>"3a1f0d9c2b7e4f6a8d5c"</CS:getctag>
        <current-user-privilege-set>
          <privilege><read /></privilege>
          <privilege><write /></privilege>
          <privilege><write-properties /></privilege>
          <privilege><write-content /></privilege>
        </current-user-privilege-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/caldav/alice/shared-ro/</href>
    <propstat>
      <prop>
        <resourcetype>
          <C:calendar />
          <collection />
        </resourcetype>
        <displayname>Team (read only)</displayname>
        <CS:getctag>"ffee"</CS:getctag>
        <current-user-privilege-set>
          <privilege><read /></privilege>
          <privilege><read-current-user-privilege-set /></privilege>
        </current-user-privilege-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
    <propstat>
      <prop>
        <C:calendar-description />
        <ICAL:calendar-color />
      </prop>
      <status>HTTP/1.1 404 Not Found</status>
    </propstat>
  </response>
  <response>
    <href>/caldav/alice/contacts/</href>
    <propstat>
      <prop>
        <resourcetype>
          <CR:addressbook xmlns:CR="urn:ietf:params:xml:ns:carddav" />
          <collection />
        </resourcetype>
        <displayname>Contacts</displayname>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`

export const EVENTS_RESPONSE = `<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/caldav/alice/personal/event-1.ics</href>
    <propstat>
      <prop>
        <getetag>"e1a2b3"</getetag>
        <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Lunch &amp; Learn
END:VEVENT
END:VCALENDAR
</C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/caldav/alice/personal/no-data.ics</href>
    <propstat>
      <prop>
        <getetag>"abc"</getetag>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`
