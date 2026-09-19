import axios from "axios";
type ShapeRow = {
    id: string;
    type: string;
    data: any;
    roomId: number;
    userId: string;
  };
export async function getExistingShapes(roomId: string) {
    const token = localStorage.getItem("token")
    const res = await axios.get(`http://localhost:3001/shapes/${roomId}`, {headers : {
        Authorization : `Bearer ${token}`
    }});
    const shapes:ShapeRow[] = res.data.shapes;


    // keep the id: it is how we recognise our own shapes coming back to us,
    // and what delete/move will address in a later step
    return shapes.map(s => ({
        id: s.id, type:s.type,  ...s.data
    }));
}