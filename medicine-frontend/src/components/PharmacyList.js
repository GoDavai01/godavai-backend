import React, { useEffect, useState } from 'react'; 
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

const PharmacyList = () => {
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { setSelectedPharmacy, clearCart } = useCart();

  useEffect(() => {
    const fetchPharmacies = async () => {
      try {
        const res = await axios.get('/api/pharmacies'); // <-- Use relative path for production
        setPharmacies(res.data);
      } catch (error) {
        setPharmacies([]);
        // Optionally show a user-facing error message with a Snackbar/toast here
      } finally {
        setLoading(false);
      }
    };
    fetchPharmacies();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!pharmacies.length) return <div>No pharmacies found.</div>;

  return (
    <div>
      <h2>Pharmacies</h2>
      <ul>
        {pharmacies.map(pharmacy => (
          <li
            key={pharmacy._id}
            onClick={() => {
              setSelectedPharmacy(pharmacy);
              clearCart(); // Optional: empty cart when new pharmacy is selected
              navigate(`/medicines/${pharmacy._id}`);
            }}
            style={{
              cursor: 'pointer',
              padding: '10px',
              border: '1px solid #ddd',
              margin: '8px 0',
              borderRadius: '6px',
              background: '#f9f9f9'
            }}
          >
            <strong>{pharmacy.name}</strong> ({pharmacy.city})<br />
            {pharmacy.address}, {pharmacy.phone}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PharmacyList;
