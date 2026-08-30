import { TopNav } from './Nav.jsx'
import { usePage } from './routing.js'
import Search from './Search.jsx'
import About from './About.jsx'
import Catalog from './Catalog.jsx'
import { CinematicBackdrop } from './Backdrop.jsx'

// About and Catalog share the Milky Way backdrop; Search owns its own astronaut story.
const PAGES = {
  about: () => <div className="about-page"><CinematicBackdrop variant="about" /><About /></div>,
  catalog: () => <div className="about-page"><CinematicBackdrop variant="about" /><Catalog /></div>,
  search: () => <Search />,
}

export default function App() {
  const page = usePage()
  const Page = PAGES[page]
  return (
    <>
      <TopNav page={page} />
      <Page />
    </>
  )
}
