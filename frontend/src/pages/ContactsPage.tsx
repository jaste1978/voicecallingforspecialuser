import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../lib/auth'
import { fmtNumber } from '../lib/format'
import { avatarColor } from '../components/Avatar'
import { PhoneIcon, TrashIcon, XIcon } from '../components/icons'

interface Contact {
  id: number
  name: string
  number: string
}

export default function ContactsPage() {
  const navigate = useNavigate()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [dialNumber, setDialNumber] = useState('')
  const [adding, setAdding] = useState(false)

  function load() {
    authFetch('/api/contacts')
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []))
      .catch(() => {})
  }

  useEffect(load, [])

  async function addContact() {
    if (!name.trim() || !number.trim()) return
    await authFetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), number: number.trim() }),
    })
    setName('')
    setNumber('')
    setAdding(false)
    load()
  }

  async function removeContact(id: number) {
    await authFetch(`/api/contacts/${id}`, { method: 'DELETE' })
    load()
  }

  function call(num: string, contactName: string) {
    navigate('/call', { state: { dial: { number: num, name: contactName } } })
  }

  return (
    <main className="contacts-page">
      <div className="dialbar">
        <input
          className="dialinput"
          type="text"
          inputMode="email"
          placeholder="Number or @sathi-id…"
          value={dialNumber}
          onChange={(e) => setDialNumber(e.target.value)}
        />
        <button
          className="bigbtn start dialcall"
          disabled={!dialNumber.trim()}
          onClick={() => call(dialNumber.trim(), dialNumber.trim())}
        >
          <PhoneIcon size={20} /> Call
        </button>
      </div>

      <div className="contacts-list">
        {contacts.length === 0 && (
          <p className="idle-hint">No contacts yet. Add the people you call often.</p>
        )}
        {contacts.map((c) => (
          <div key={c.id} className="contact-row">
            <button className="contact-main" onClick={() => call(c.number, c.name)}>
              <span
                className="contact-avatar named"
                style={{ background: avatarColor(c.name) }}
              >
                {c.name.trim().charAt(0).toUpperCase()}
              </span>
              <span>
                <span className="contact-name">{c.name}</span>
                <span className="contact-number">{fmtNumber(c.number)}</span>
              </span>
            </button>
            <button
              className="contact-callbtn"
              aria-label={`Call ${c.name}`}
              onClick={() => call(c.number, c.name)}
            >
              <PhoneIcon size={22} />
            </button>
            <button
              className="contact-delete"
              aria-label={`Delete ${c.name}`}
              onClick={() => removeContact(c.id)}
            >
              <TrashIcon size={20} />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="contact-add-form">
          <input
            className="dialinput"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="dialinput"
            type="tel"
            inputMode="tel"
            placeholder="Phone number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <div className="contact-add-actions">
            <button className="iconbtn" aria-label="Cancel" onClick={() => setAdding(false)}>
              <XIcon size={22} />
            </button>
            <button
              className="bigbtn start"
              disabled={!name.trim() || !number.trim()}
              onClick={() => void addContact()}
            >
              Save contact
            </button>
          </div>
        </div>
      ) : (
        <button className="bigbtn start addcontact" onClick={() => setAdding(true)}>
          ＋ Add contact
        </button>
      )}
    </main>
  )
}
