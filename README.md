# Nostr-Doc

## Overview

Nostr-Doc is an application that leverages Nostr relays and Yjs to provide real-time collaboration for editing documents. It allows multiple users to edit Markdown content simultaneously while ensuring conflict-free replication.

## Features

- **Real-Time Collaboration:** Users can work on the same document in real-time, with changes being synced across all connected clients.
- **Nostr Integration:** The application uses Nostr relays for publishing and fetching events, making it suitable for decentralized applications.
- **Yjs for CRDTs:** Yjs is used to handle conflict-free replicated data types (CRDTs), ensuring that updates are applied seamlessly.

## Usage

1. Clone the repository:

   ```sh
   git clone https://github.com/formstr-hq/nostr-docs.git
   cd nostr-docs
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Start the development server:

   ```sh
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173` (or the specified port).

## Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests.

## License

This project is licensed under the MIT License.
