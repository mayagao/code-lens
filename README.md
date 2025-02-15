# CodeLens

CodeLens helps users understand their evolving codebase by providing AI-powered analysis of repositories and commits, with a focus on learning and visualization.

## Features

- Repository Overview and Analysis
- Commit Analysis and Learning
- Interactive System Architecture Diagrams
- Concept Tracking and Learning Management

## Tech Stack

- Frontend: Next.js 14 with TypeScript
- State Management: Zustand
- UI: TailwindCSS with shadcn/ui components
- Visualization: Mermaid.js for diagrams
- Authentication: GitHub OAuth

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```

## Project Structure

```
src/
├── app/             # Next.js app router pages
├── components/      # React components
│   ├── ui/         # Reusable UI components
│   ├── repo/       # Repository-related components
│   ├── commit/     # Commit analysis components
│   └── concept/    # Learning and concept components
├── lib/            # Library configurations
├── store/          # Zustand store definitions
├── types/          # TypeScript type definitions
├── utils/          # Utility functions
├── services/       # External service integrations
└── hooks/          # Custom React hooks
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
