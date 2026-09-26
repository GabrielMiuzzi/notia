import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Bell, Bolt, Book, BookOpen, Bookmark, Braces, Brain, Brush, Calendar, Camera, Check, ChevronDown, ChevronRight,
  Circle, CircleCheck, CircleHelp, CircleX, Clock, Cloud, Code, Coffee, Columns2, Copy, Cpu, Database, Download,
  Eraser, ExternalLink, Eye, File, FileText, Filter, Flag, Folder, Gift, GitBranch, Github, Globe, Heart, House,
  Image, Info, Key, Layers, LayoutGrid, Lightbulb, Link, ListOrdered, Lock, Mail, Map as MapIcon, MapPin, MessageSquare,
  Monitor, Music, Newspaper, OctagonAlert, Package, Palette, PanelTop, Paperclip, Pencil, PenLine, Play, Plus,
  Puzzle, Repeat, Rocket, Search, Send, Server, Settings, Share2, Shield, Smartphone, Sparkles, Star, Tag, Terminal,
  ThumbsUp, Trash2, TriangleAlert, Trophy, Undo2, Upload, User, Users, Variable, Video, Workflow, Wrench, X, Zap,
} from 'lucide-react'

/*
 * Icons of the GitBook blocks. GitBook names Font Awesome icons; Notia draws
 * the closest Lucide icon (the set the rest of the app uses) and a circle for
 * the ones it does not know. The markup is rendered once per name.
 */

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>

const ICONS: Record<string, IconComponent> = {
  // Controls of the blocks.
  'notia-add': Plus, 'notia-remove': X, 'notia-edit': Pencil, 'notia-copy': Copy, 'notia-open': ExternalLink,
  'notia-chevron': ChevronDown, 'notia-undo': Undo2, 'notia-eraser': Eraser, 'notia-trash': Trash2,
  'notia-condition': GitBranch, 'notia-include': Repeat, 'notia-variable': Variable, 'notia-columns': Columns2,
  'notia-steps': ListOrdered, 'notia-tabs': PanelTop, 'notia-updates': Newspaper, 'notia-cards': LayoutGrid,
  'notia-drawing': Brush, 'notia-prompt': Sparkles, 'notia-embed': Globe, 'notia-page': FileText, 'notia-file': Paperclip,
  'notia-details': ChevronRight, 'notia-code': Code, 'notia-annotation': MessageSquare, 'notia-button': PenLine,
  // Hint styles.
  info: Info, 'circle-info': Info, 'info-circle': Info, success: CircleCheck, 'circle-check': CircleCheck,
  'check-circle': CircleCheck, warning: TriangleAlert, 'triangle-exclamation': TriangleAlert,
  'exclamation-triangle': TriangleAlert, danger: OctagonAlert, 'octagon-exclamation': OctagonAlert,
  'circle-exclamation': OctagonAlert, 'circle-xmark': CircleX, xmark: X,
  // Font Awesome names GitBook uses often.
  check: Check, bell: Bell, bolt: Bolt, book: Book, 'book-open': BookOpen, books: Book, bookmark: Bookmark,
  'brackets-curly': Braces, brain: Brain, calendar: Calendar, camera: Camera, clock: Clock, cloud: Cloud, code: Code,
  coffee: Coffee, copy: Copy, microchip: Cpu, database: Database, download: Download, 'arrow-down-to-line': Download,
  eye: Eye, file: File, 'file-lines': FileText, filter: Filter, flag: Flag, folder: Folder, gift: Gift,
  'code-branch': GitBranch, github: Github, globe: Globe, heart: Heart, house: House, home: House, image: Image,
  key: Key, 'layer-group': Layers, lightbulb: Lightbulb, link: Link, lock: Lock, envelope: Mail, map: MapIcon,
  'location-dot': MapPin, 'map-marker': MapPin, comment: MessageSquare, message: MessageSquare, desktop: Monitor,
  music: Music, newspaper: Newspaper, box: Package, palette: Palette, paperclip: Paperclip, pen: Pencil,
  pencil: Pencil, play: Play, plus: Plus, 'puzzle-piece': Puzzle, rocket: Rocket, 'magnifying-glass': Search,
  search: Search, 'paper-plane': Send, server: Server, gear: Settings, gears: Settings, cog: Settings,
  share: Share2, 'share-nodes': Share2, shield: Shield, 'shield-halved': Shield, mobile: Smartphone, stars: Sparkles,
  sparkles: Sparkles, 'wand-magic-sparkles': Sparkles, star: Star, tag: Tag, tags: Tag, terminal: Terminal,
  'rectangle-terminal': Terminal, 'thumbs-up': ThumbsUp, trash: Trash2, trophy: Trophy, upload: Upload, user: User,
  users: Users, video: Video, 'diagram-project': Workflow, wrench: Wrench, 'screwdriver-wrench': Wrench, flask: Zap,
  'circle-question': CircleHelp, question: CircleHelp,
}

const markupCache = new Map<string, string>()

/** SVG markup of an icon, by its Font Awesome name (without `fa-`) or a `notia-` control name. */
export function iconMarkup(name: string, size = 16): string {
  const key = `${name}:${size}`
  const cached = markupCache.get(key)
  if (cached !== undefined) return cached
  const Icon = ICONS[name.replace(/^fa-/, '').toLowerCase()] ?? Circle
  const markup = renderToStaticMarkup(createElement(Icon, { size, strokeWidth: 2, 'aria-hidden': true }))
  markupCache.set(key, markup)
  return markup
}

export function isKnownIcon(name: string): boolean {
  return name.replace(/^fa-/, '').toLowerCase() in ICONS
}
