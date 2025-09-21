import axios from "axios";

export async function getExistingShapes(roomId: string) {
    const res = await axios.get(`http://localhost:3001/chats/${roomId}`);
    const messages = res.data.messages;

    const shapes = messages.map((x: {message: string}) => {
        const messageData = JSON.parse(x.message)
        return messageData.shape;
    })

    return shapes;
}